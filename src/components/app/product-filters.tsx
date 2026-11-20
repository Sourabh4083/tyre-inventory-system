"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, ScanBarcode, Search, X } from "lucide-react";
import { toast } from "sonner";
import { lookupProductByCodeAction } from "@/app/actions/products";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";
import { cn } from "@/lib/utils";
import { FITMENTS, TUBE_TYPES, VEHICLE_TYPES } from "@/lib/tyre";

type Category = { id: string; name: string };

/**
 * Search box + filters. The search updates the URL (debounced) so results are
 * server-rendered and shareable. Pressing Enter with an exact barcode/SKU opens the product.
 *
 * USB barcode scanners type the code quickly and send Enter, which this handles.
 */
export function ProductFilters({
  categories,
  showFilters = true,
  autoFocus,
  tyreFilters,
}: {
  categories: Category[];
  /** true = all filters, "pricing" = category + sort only, false = search only */
  showFilters?: boolean | "pricing";
  autoFocus?: boolean;
  /** A second row of tyre filters (vehicle, brand, rim, tubeless, fitment) with the brands and rims in use. */
  tyreFilters?: { brands: string[]; rimSizes: number[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [lookingUp, setLookingUp] = useState(false);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync when the URL changes from elsewhere (e.g. back button).
  // Our own searches reach the URL a moment after they are typed, so they must never
  // be copied back into the box: that would wipe the letters typed in the meantime.
  const urlQ = params.get("q") ?? "";
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  const [pushedQ, setPushedQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    setSeenUrlQ(urlQ);
    if (!pending && urlQ !== pushedQ) {
      setPushedQ(urlQ);
      setQuery(urlQ);
    }
  }

  const pushParams = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    setPushedQ(next.get("q") ?? "");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pushParams((p) => {
        if (value.trim()) p.set("q", value.trim());
        else p.delete("q");
      });
    }, 250);
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = query.trim();
    if (!code) return;
    if (timer.current) clearTimeout(timer.current);
    setLookingUp(true);
    try {
      const res = await lookupProductByCodeAction(code);
      if (res.ok && res.data) {
        router.push(`/inventory/${res.data.id}?from=scan`);
        return;
      }
      // No exact match: just apply the search immediately.
      pushParams((p) => p.set("q", code));
      if (/^\d{6,}$/.test(code)) toast.info("No product has this barcode.", { description: "Showing search results instead." });
    } finally {
      setLookingUp(false);
    }
  };

  const clear = () => {
    setQuery("");
    pushParams((p) => p.delete("q"));
    inputRef.current?.focus();
  };

  const tyreSelect = (key: string, label: string, options: { value: string; label: string }[], width: string) => (
    <NativeSelect
      aria-label={label}
      value={params.get(key) ?? ""}
      onChange={(e) => pushParams((p) => (e.target.value ? p.set(key, e.target.value) : p.delete(key)))}
      className={cn("h-11 rounded-xl bg-card", width)}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
  const tyreFilterKeys = ["vehicle", "brand", "rim", "tube", "fit"];
  const anyTyreFilter = tyreFilterKeys.some((k) => params.get(k));

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search size (185/65 R15), name, SKU or barcode..."
            aria-label="Search products"
            autoFocus={autoFocus}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-12 rounded-xl bg-card pr-20 pl-11 text-base shadow-xs"
          />
          <div className="absolute inset-y-0 right-2 flex items-center gap-1">
            {pending || lookingUp ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
            {query ? (
              <button type="button" onClick={clear} aria-label="Clear search" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            ) : (
              <span title="Barcode scanners work here: scan and the product opens." className="hidden size-9 items-center justify-center text-muted-foreground sm:flex">
                <ScanBarcode className="size-4.5" />
              </span>
            )}
          </div>
        </div>

        {showFilters ? (
          <div className={cn("grid grid-cols-2 gap-2 lg:flex lg:shrink-0")}>
            <NativeSelect
              aria-label="Category"
              value={params.get("category") ?? ""}
              onChange={(e) => pushParams((p) => (e.target.value ? p.set("category", e.target.value) : p.delete("category")))}
              className="h-12 rounded-xl bg-card lg:w-44"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {showFilters !== "pricing" ? (
              <NativeSelect
                aria-label="Stock status"
                value={params.get("status") ?? ""}
                onChange={(e) => pushParams((p) => (e.target.value ? p.set("status", e.target.value) : p.delete("status")))}
                className="h-12 rounded-xl bg-card lg:w-40"
              >
                <option value="">All stock levels</option>
                <option value="IN_STOCK">In stock</option>
                <option value="LOW_STOCK">Low stock</option>
                <option value="OUT_OF_STOCK">Out of stock</option>
              </NativeSelect>
            ) : null}
            <NativeSelect
              aria-label="Sort by"
              value={params.get("sort") ?? "name"}
              onChange={(e) => pushParams((p) => (e.target.value === "name" ? p.delete("sort") : p.set("sort", e.target.value)))}
              className="col-span-2 h-12 rounded-xl bg-card lg:w-48"
            >
              <option value="name">Sort: Name A–Z</option>
              <option value="quantity">Sort: Quantity (low → high)</option>
              <option value="price">Sort: Price (low → high)</option>
              <option value="updated">Sort: Recently updated</option>
            </NativeSelect>
          </div>
        ) : null}
      </div>
      {tyreFilters ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
          {tyreSelect("vehicle", "All vehicles", VEHICLE_TYPES, "lg:w-40")}
          {tyreFilters.brands.length > 1 ? tyreSelect("brand", "All brands", tyreFilters.brands.map((b) => ({ value: b, label: b })), "lg:w-40") : null}
          {tyreSelect("rim", "All rim sizes", tyreFilters.rimSizes.map((r) => ({ value: String(r), label: `${r} inch` })), "lg:w-36")}
          {tyreSelect("tube", "Tubeless & tube", TUBE_TYPES, "lg:w-40")}
          {tyreSelect("fit", "Any fitment", FITMENTS, "lg:w-36")}
          {anyTyreFilter ? (
            <button
              type="button"
              onClick={() => pushParams((p) => tyreFilterKeys.forEach((k) => p.delete(k)))}
              className="h-11 rounded-xl px-3 text-sm font-medium text-primary hover:bg-accent"
            >
              Clear tyre filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
