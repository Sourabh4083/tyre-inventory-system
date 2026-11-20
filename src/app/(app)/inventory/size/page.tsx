import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Disc3, PackagePlus, Search } from "lucide-react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { findTyresBySize, productsForViewer } from "@/lib/services/products";
import { formatMoney } from "@/lib/format";
import { tyreSpecLine } from "@/lib/tyre";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { StockBadge } from "@/components/app/stock-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Find by Size" };

/**
 * The counter screen: a customer asks for a size, staff type it however they like
 * ("185/65 R15", "1856515", "185 65 15") and see every tyre in that size with stock and price.
 */
export default async function FindBySizePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUserPage();
  const q = ((await searchParams).q ?? "").trim();
  const [settings, groups] = await Promise.all([getSettings(), q ? findTyresBySize(q) : Promise.resolve([])]);
  const sym = settings.currencySymbol;
  const found = groups.reduce((n, g) => n + g.products.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Find by Size" description="Type the size the customer asks for. Every brand and pattern in that size, with stock and price." />

      <form method="get" className="flex gap-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="e.g. 185/65 R15, 1856515, 10.00-20, 100/90-17"
            aria-label="Tyre size"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="search"
            className="h-12 rounded-xl bg-card pl-11 font-mono text-base shadow-xs"
          />
        </div>
        <Button type="submit" size="lg" className="h-12">
          Find
        </Button>
      </form>

      {!q ? (
        <EmptyState icon={Disc3} title="Type a tyre size" description="Spaces, slashes and the R don't matter: 185/65 R15, 185 65 15 and 1856515 all find the same tyres." />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Disc3}
          title={`No tyres in “${q}”`}
          description="Check the size, or add this tyre to the stock list."
          action={
            <Button size="lg" className="h-11" render={<Link href="/inventory/new" />}>
              <PackagePlus /> Add Product
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {found} {found === 1 ? "tyre" : "tyres"} in {groups.length} {groups.length === 1 ? "size" : "sizes"}
          </p>
          {groups.map((g) => (
            <section key={g.sizeKey} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
              <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
                <h2 className="font-mono text-lg font-semibold">{g.size}</h2>
                <span className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{g.totalQuantity}</span> in stock
                </span>
              </header>
              <ul className="divide-y">
                {productsForViewer(g.products, user.role).map((p) => (
                  <li key={p.id}>
                    <Link href={`/inventory/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{[p.brand, p.pattern].filter(Boolean).join(" ") || p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{tyreSpecLine(p) || p.categoryName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">{formatMoney(p.sellingPrice, sym)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{p.quantity} in stock</p>
                      </div>
                      <StockBadge status={p.stockStatus} className="hidden sm:inline-flex" />
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
