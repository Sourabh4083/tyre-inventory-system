"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { importPriceListAction, previewPriceListAction } from "@/app/actions/pricing";
import type { ImportPreview, ImportResult } from "@/lib/services/price-import";
import { PRICE_FIELD_LABEL } from "@/lib/prices";
import { VEHICLE_TYPE_LABEL } from "@/lib/tyre";
import { formatMoney, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SHOW = 100;

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-xs">
      <p className={cn("text-2xl font-semibold tabular-nums sm:text-3xl", tone)}>{formatNumber(value)}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function More({ total }: { total: number }) {
  return total > SHOW ? <p className="px-4 py-2 text-xs text-muted-foreground">…and {formatNumber(total - SHOW)} more</p> : null;
}

export function PriceListImport({ currencySymbol: sym }: { currencySymbol: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();

  const form = () => {
    const fd = new FormData();
    fd.set("file", file!);
    return fd;
  };

  const check = () => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setResult(null);
    startCheck(async () => {
      const res = await previewPriceListAction(form());
      if (res.ok) setPreview(res.data);
      else setError(res.error);
    });
  };

  const runImport = () => {
    setError(null);
    startImport(async () => {
      const res = await importPriceListAction(form());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      setPreview(null);
      toast.success("Price list imported", { description: `${res.data.updated} updated · ${res.data.created} added` });
    });
  };

  const nothingToDo = preview && !preview.updates.length && !preview.creates.length;
  const busy = checking || importing;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
            setError(null);
          }}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => input.current?.click()} disabled={busy}>
            <FileSpreadsheet /> {file ? "Choose another file" : "Choose price list"}
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{file ? file.name : "No file chosen"}</p>
          <Button type="button" size="lg" className="h-11" onClick={check} disabled={!file || busy}>
            {checking ? <LoaderCircle className="animate-spin" /> : <Upload />} Check the file
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Prices are saved as printed in the list. A selling price you have set is never changed; MSRP fills it only when it is empty.
        </p>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 sm:p-6 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <p className="flex items-center gap-2 font-heading text-lg">
            <CheckCircle2 className="size-5" /> Price list imported
          </p>
          <p className="mt-1 text-sm">
            {formatNumber(result.updated)} products got new prices, {formatNumber(result.created)} new tyres were added, {formatNumber(result.unchanged)} were already up to date
            {result.skipped ? `, ${formatNumber(result.skipped)} rows were skipped` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="lg" className="h-11" render={<Link href="/pricing" />}>
              Go to Prices &amp; Margins
            </Button>
          </div>
        </section>
      ) : null}

      {preview ? (
        <>
          <section aria-label="What will change" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Products with new prices" value={preview.updates.length} tone="text-primary" />
            <Tile label="New tyres to add" value={preview.creates.length} tone="text-sky-700 dark:text-sky-300" />
            <Tile label="Already up to date" value={preview.unchanged} tone="text-emerald-700 dark:text-emerald-300" />
            <Tile label="Rows skipped" value={preview.skipped.length} tone={preview.skipped.length ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"} />
          </section>
          <p className="text-sm text-muted-foreground">
            {formatNumber(preview.rowsRead)} tyres read from {preview.fileName}.
            {preview.ocrFixes ? ` ${formatNumber(preview.ocrFixes)} numbers where the file showed "G" for 9 were corrected.` : ""}
          </p>

          {preview.updates.length ? (
            <details open className="rounded-2xl border bg-card shadow-xs">
              <summary className="cursor-pointer px-4 py-3 font-heading text-lg sm:px-6">Price changes ({formatNumber(preview.updates.length)})</summary>
              <ul className="divide-y border-t text-sm">
                {preview.updates.slice(0, SHOW).map((u) => (
                  <li key={u.line} className="px-4 py-2 sm:px-6">
                    <Link href={`/inventory/${u.productId}`} className="font-medium hover:text-primary">
                      {u.productName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {u.changes.map((c) => `${PRICE_FIELD_LABEL[c.field]} ${c.oldValue ? formatMoney(c.oldValue, sym) : "none"} → ${formatMoney(c.newValue, sym)}`).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
              <More total={preview.updates.length} />
            </details>
          ) : null}

          {preview.creates.length ? (
            <details className="rounded-2xl border bg-card shadow-xs">
              <summary className="cursor-pointer px-4 py-3 font-heading text-lg sm:px-6">New tyres to add ({formatNumber(preview.creates.length)})</summary>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground sm:px-6">
                Added with 0 in stock.{" "}
                {Object.entries(
                  preview.creates.reduce<Record<string, number>>((m, c) => ({ ...m, [c.vehicleType]: (m[c.vehicleType] ?? 0) + 1 }), {}),
                )
                  .map(([v, n]) => `${VEHICLE_TYPE_LABEL[v as keyof typeof VEHICLE_TYPE_LABEL]} ${n}`)
                  .join(" · ")}
              </p>
              <ul className="divide-y border-t text-sm">
                {preview.creates.slice(0, SHOW).map((c) => (
                  <li key={c.line} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 sm:px-6">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {[c.nlc ? `NLC ${formatMoney(c.nlc, sym)}` : null, c.msrp ? `MSRP ${formatMoney(c.msrp, sym)}` : null, c.ndp ? `NDP ${formatMoney(c.ndp, sym)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              <More total={preview.creates.length} />
            </details>
          ) : null}

          {preview.skipped.length ? (
            <details open className="rounded-2xl border border-amber-300 bg-card shadow-xs dark:border-amber-500/30">
              <summary className="cursor-pointer px-4 py-3 font-heading text-lg sm:px-6">Skipped rows ({formatNumber(preview.skipped.length)})</summary>
              <ul className="divide-y border-t text-sm">
                {preview.skipped.map((s) => (
                  <li key={`${s.line}-${s.reason}`} className="px-4 py-2 sm:px-6">
                    <p>
                      <span className="text-muted-foreground">Row {s.line}:</span> {s.reason}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{s.text}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="sticky bottom-3 flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-md sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              {nothingToDo
                ? "Everything is already up to date."
                : `Import will update ${formatNumber(preview.updates.length)} products and add ${formatNumber(preview.creates.length)} new tyres.`}
            </p>
            <Button size="lg" className="h-11" onClick={runImport} disabled={busy || Boolean(nothingToDo)}>
              {importing ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />} Import
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
