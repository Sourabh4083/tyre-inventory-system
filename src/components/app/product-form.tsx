"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ChevronDown, LoaderCircle, Save } from "lucide-react";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import type { ProductDTO } from "@/lib/services/products";
import type { ProductCreateInput } from "@/lib/validation/schemas";
import { UNITS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { CONSTRUCTIONS, FITMENTS, TUBE_TYPES, VEHICLE_TYPES, buildTyreName, parseTyreSize, sizeSearchKey } from "@/lib/tyre";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { NativeSelect } from "@/components/app/native-select";
import { QuantityStepper } from "@/components/app/quantity-stepper";

type Category = { id: string; name: string; isTyre?: boolean };

type FormValues = {
  name: string;
  categoryId: string;
  sellingPrice: string;
  costPrice: string;
  sku: string;
  barcode: string;
  startingQuantity: string;
  unit: string;
  location: string;
  description: string;
  notes: string;
  lowStockThreshold: string;
  tyreSize: string;
  brand: string;
  pattern: string;
  vehicleType: string;
  construction: string;
  tubeType: string;
  fitment: string;
  plyRating: string;
  nsdMm: string;
  materialCode: string;
};

/** Units a tyre shop sells other items in. Tyres are always sold by the piece. */
const SHOP_UNITS = new Set(["PIECE", "PAIR", "SET", "PACK", "BOX"]);
/** Fields kept in the folded "More details" card; it opens by itself when one of them has an error. */
const MORE_FIELDS = ["construction", "fitment", "plyRating", "nsdMm", "materialCode", "barcode", "notes"];

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
      <h2 className="font-heading text-lg">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function ProductForm({
  categories,
  currencySymbol,
  product,
  isOwner,
  globalThreshold,
  defaultName,
  defaultBrand = "",
  hideStartingStock,
  onSaved,
  onCancel,
}: {
  categories: Category[];
  currencySymbol: string;
  product?: ProductDTO;
  isOwner: boolean;
  globalThreshold: number;
  defaultName?: string;
  /** Filled in on a new tyre (the shop's main brand, from Settings). */
  defaultBrand?: string;
  /** For a product that is only being ordered: it starts at 0 and arrives with the order. */
  hideStartingStock?: boolean;
  /** Set when the form sits in a dialog: called with the saved product instead of opening its page. */
  onSaved?: (product: ProductDTO) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(product);

  // Text typed in a search box that looks like a size ("185/65 R15") starts the tyre size;
  // any other text is taken as the product's name.
  const sizeFromSearch = !editing && defaultName && sizeSearchKey(defaultName) ? defaultName : "";
  const nameFromSearch = !editing && defaultName && !sizeFromSearch ? defaultName : "";
  // A new tyre's name is written from its details until someone types a name of their own.
  const [nameTouched, setNameTouched] = useState(editing || Boolean(nameFromSearch));
  const firstCategory = categories.find((c) => c.isTyre) ?? categories[0];
  // More details start open when editing a product that already has some of them.
  const [moreOpen, setMoreOpen] = useState(
    // (Radial or bias is filled in from the size on almost every tyre, so it does not count.)
    Boolean(product && (product.fitment || product.plyRating || product.nsdMm || product.materialCode || product.barcode || product.notes)),
  );

  const form = useForm<FormValues>({
    defaultValues: {
      name: product?.name ?? nameFromSearch,
      categoryId: product?.categoryId ?? firstCategory?.id ?? "",
      sellingPrice: product?.sellingPrice ?? "",
      costPrice: product?.costPrice ?? "",
      // SKU and description are no longer on the form; any saved value is kept as it is.
      sku: product?.sku ?? "",
      barcode: product?.barcode ?? "",
      startingQuantity: "0",
      unit: product?.unit ?? "PIECE",
      location: product?.location ?? "",
      description: product?.description ?? "",
      notes: product?.notes ?? "",
      lowStockThreshold: product?.lowStockThreshold != null ? String(product.lowStockThreshold) : "",
      tyreSize: product?.tyreSize ?? sizeFromSearch,
      brand: product ? (product.brand ?? "") : defaultBrand,
      pattern: product?.pattern ?? "",
      vehicleType: product?.vehicleType ?? "",
      construction: product?.construction ?? "",
      tubeType: product?.tubeType ?? "",
      fitment: product?.fitment ?? "",
      plyRating: product?.plyRating != null ? String(product.plyRating) : "",
      nsdMm: product?.nsdMm ?? "",
      materialCode: product?.materialCode ?? "",
    },
  });
  const { register, handleSubmit, control, setValue, getValues, formState } = form;
  const startingQuantity = useWatch({ control, name: "startingQuantity" });
  const categoryId = useWatch({ control, name: "categoryId" });
  const [tyreSize, brand, pattern, tubeType, plyRating] = useWatch({ control, name: ["tyreSize", "brand", "pattern", "tubeType", "plyRating"] });
  const category = categories.find((c) => c.id === categoryId);
  const isTyre = Boolean(category?.isTyre);
  const errors = { ...serverErrors };
  for (const [k, v] of Object.entries(formState.errors)) if (v?.message) errors[k] = String(v.message);
  // A folded field with an error keeps the card open so the message is seen.
  const showMore = moreOpen || MORE_FIELDS.some((k) => errors[k]);

  // No size yet means no name yet: a brand on its own is not a product name.
  const parsedSize = parseTyreSize(tyreSize);
  const autoName = parsedSize
    ? buildTyreName({ tyreSize: parsedSize.size, brand, pattern, tubeType: (tubeType || null) as ProductDTO["tubeType"], plyRating: plyRating ? Number(plyRating) : null })
    : "";

  // Keep the name in step with the tyre details until it is typed by hand. Switching to a
  // category that isn't tyres clears a name that was only written from tyre details.
  useEffect(() => {
    if (!nameTouched) setValue("name", isTyre ? autoName : "");
  }, [isTyre, nameTouched, autoName, setValue]);

  /** Tidy the typed size and fill in radial/bias and ply rating when they can be read from it. */
  const onSizeBlur = () => {
    const parsed = parseTyreSize(getValues("tyreSize"));
    if (!parsed) return;
    setValue("tyreSize", parsed.size);
    if (!getValues("construction") && parsed.construction) setValue("construction", parsed.construction);
    if (!getValues("plyRating") && parsed.plyRating) setValue("plyRating", String(parsed.plyRating));
  };

  // Units: the shop's short list, plus whatever an older product was saved with.
  const unitOptions = UNITS.filter((u) => SHOP_UNITS.has(u.value) || u.value === product?.unit);

  const onSubmit = (values: FormValues) => {
    setServerErrors({});
    setFormError(null);
    if (!values.name.trim()) {
      setServerErrors(isTyre && !nameTouched ? { tyreSize: "Enter the tyre size, e.g. 185/65 R15." } : { name: "Product name is required." });
      return;
    }
    const payload: ProductCreateInput = {
      name: values.name,
      categoryId: values.categoryId,
      // Prices are owner-only; the server ignores them for managers anyway.
      sellingPrice: isOwner ? values.sellingPrice : "",
      costPrice: isOwner ? values.costPrice : "",
      sku: values.sku,
      barcode: values.barcode,
      startingQuantity: values.startingQuantity === "" ? 0 : Number(values.startingQuantity),
      // Tyres are sold by the piece.
      unit: (isTyre ? "PIECE" : values.unit) as ProductCreateInput["unit"],
      location: values.location,
      description: values.description,
      notes: values.notes,
      lowStockThreshold: values.lowStockThreshold === "" ? "" : Number(values.lowStockThreshold),
      // Tubes, flaps and other items carry no tyre details.
      tyreSize: isTyre ? values.tyreSize : "",
      brand: isTyre ? values.brand : "",
      pattern: isTyre ? values.pattern : "",
      vehicleType: (isTyre ? values.vehicleType : "") as ProductCreateInput["vehicleType"],
      construction: (isTyre ? values.construction : "") as ProductCreateInput["construction"],
      tubeType: (isTyre ? values.tubeType : "") as ProductCreateInput["tubeType"],
      fitment: (isTyre ? values.fitment : "") as ProductCreateInput["fitment"],
      plyRating: isTyre && values.plyRating !== "" ? values.plyRating : "",
      nsdMm: isTyre && values.nsdMm !== "" ? values.nsdMm : "",
      materialCode: values.materialCode,
    };
    start(async () => {
      const res = editing ? await updateProductAction(product!.id, payload) : await createProductAction(payload);
      if (!res.ok) {
        setServerErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(editing ? "Product updated" : "Product saved", { description: `${res.data.name} · Stock ${res.data.quantity}` });
      if (onSaved) onSaved(res.data);
      else router.push(`/inventory/${res.data.id}`);
    });
  };

  const select = (id: keyof FormValues, options: { value: string; label: string }[], placeholder = "Not set") => (
    <NativeSelect id={id} className="h-11" {...register(id)} aria-invalid={Boolean(errors[id])}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* 1. What it is */}
      <Card title="Product">
        <Field label="Category" htmlFor="categoryId" required error={errors.categoryId}>
          <NativeSelect id="categoryId" className="h-11" {...register("categoryId", { required: "Select a category." })} aria-invalid={Boolean(errors.categoryId)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {isTyre ? (
          <>
            <Field label="Vehicle" htmlFor="vehicleType" error={errors.vehicleType}>
              {select("vehicleType", VEHICLE_TYPES, "Choose vehicle")}
            </Field>
            <Field label="Tyre size" htmlFor="tyreSize" required error={errors.tyreSize} hint="Type it any way: 185/65 R15, 1856515, 10.00-20, 100/90-17. For ZR add ZR: 2254517 ZR">
              <Input
                id="tyreSize"
                className="h-11 text-base font-medium tracking-wide"
                placeholder="e.g. 185/65 R15"
                autoFocus={!editing}
                autoCapitalize="characters"
                autoComplete="off"
                {...register("tyreSize", { onBlur: onSizeBlur })}
                aria-invalid={Boolean(errors.tyreSize)}
              />
            </Field>
            <Field label="Tubeless or tube type" htmlFor="tubeType" error={errors.tubeType}>
              {select(
                "tubeType",
                TUBE_TYPES.map((t) => ({ value: t.value, label: `${t.label} (${t.short})` })),
              )}
            </Field>
            <Field label="Brand" htmlFor="brand" error={errors.brand}>
              <Input id="brand" className="h-11 text-base" placeholder="e.g. JK Tyre" {...register("brand")} />
            </Field>
            <Field label="Pattern / model" htmlFor="pattern" error={errors.pattern}>
              <Input id="pattern" className="h-11 text-base" placeholder="e.g. UX Royale" {...register("pattern")} />
            </Field>
          </>
        ) : (
          <Field label="Unit" htmlFor="unit" error={errors.unit}>
            <NativeSelect id="unit" className="h-11" {...register("unit")}>
              {unitOptions.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}

        <Field
          label="Product name"
          htmlFor="name"
          required
          error={errors.name}
          className="sm:col-span-2"
          hint={isTyre && !nameTouched ? "Fills in from the size, brand and pattern. Type here to change it." : undefined}
        >
          <Input
            id="name"
            className="h-11 text-base"
            placeholder={isTyre ? "Fills in once you type the tyre size" : "e.g. Tube 90/90-12, Exide 35Ah battery"}
            autoFocus={!editing && !isTyre}
            {...register("name", { onChange: () => setNameTouched(true) })}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
      </Card>

      {/* 2. Price */}
      <Card title="Price">
        {isOwner ? (
          <>
            <Field label={`Selling price (${currencySymbol})`} htmlFor="sellingPrice" error={errors.sellingPrice}>
              <Input id="sellingPrice" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 5950" {...register("sellingPrice")} aria-invalid={Boolean(errors.sellingPrice)} />
            </Field>
            <Field label={`Cost price (${currencySymbol})`} htmlFor="costPrice" error={errors.costPrice} hint="What you pay for one. Only the owner sees it.">
              <Input id="costPrice" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 5194" {...register("costPrice")} aria-invalid={Boolean(errors.costPrice)} />
            </Field>
          </>
        ) : (
          <Field label={`Selling price (${currencySymbol})`} hint="Prices are set by the owner.">
            <p className="flex h-11 items-center rounded-lg border border-dashed bg-muted/40 px-3 text-base font-medium tabular-nums">
              {editing ? formatMoney(product?.sellingPrice, currencySymbol) : "Set by owner after saving"}
            </p>
          </Field>
        )}
      </Card>

      {/* 3. Stock */}
      <Card title="Stock">
        {!editing && !hideStartingStock ? (
          <Field label="Quantity in shop now" htmlFor="startingQuantity" required error={errors.startingQuantity} hint="An opening stock entry is recorded if this is above zero.">
            <QuantityStepper id="startingQuantity" min={0} value={startingQuantity} onChange={(v) => setValue("startingQuantity", v)} />
          </Field>
        ) : null}
        {isOwner ? (
          <Field label="Low stock alert at" htmlFor="lowStockThreshold" error={errors.lowStockThreshold} hint={`Optional. Leave blank to use the shop setting (${globalThreshold}).`}>
            <Input id="lowStockThreshold" className="h-11 text-base" inputMode="numeric" placeholder="Shop setting" {...register("lowStockThreshold")} aria-invalid={Boolean(errors.lowStockThreshold)} />
          </Field>
        ) : null}
        {/* Full width when it would otherwise sit alone on its row. */}
        <Field
          label="Location"
          htmlFor="location"
          error={errors.location}
          hint="Optional. Rack, shelf or godown."
          className={cn((!editing && !hideStartingStock) === isOwner && "sm:col-span-2")}
        >
          <Input id="location" className="h-11 text-base" placeholder="e.g. Rack A2" {...register("location")} />
        </Field>
      </Card>

      {/* 4. Optional extras, folded away */}
      <section className="rounded-2xl border bg-card shadow-xs">
        <button
          type="button"
          onClick={() => setMoreOpen(!showMore)}
          aria-expanded={showMore}
          aria-controls="more-details"
          className="flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left sm:px-6"
        >
          <span>
            <span className="block font-heading text-lg">More details</span>
            <span className="block text-sm text-muted-foreground">
              {isTyre ? "Optional. Radial or bias, fitment, ply rating, tread depth, company code, barcode and notes." : "Optional. Company code, barcode and notes."}
            </span>
          </span>
          <ChevronDown className={cn("size-5 shrink-0 text-muted-foreground transition-transform", showMore && "rotate-180")} />
        </button>
        <div id="more-details" hidden={!showMore} className="grid grid-cols-1 gap-4 border-t px-4 pt-4 pb-4 sm:grid-cols-2 sm:px-6 sm:pb-6">
          {isTyre ? (
            <>
              <Field label="Radial or bias" htmlFor="construction" error={errors.construction} hint="Filled in from the size when it shows R or -.">
                {select("construction", CONSTRUCTIONS)}
              </Field>
              <Field label="Fitment" htmlFor="fitment" error={errors.fitment}>
                {select("fitment", FITMENTS)}
              </Field>
              <Field label="Ply rating (PR)" htmlFor="plyRating" error={errors.plyRating}>
                <Input id="plyRating" className="h-11 text-base" inputMode="numeric" placeholder="e.g. 16" {...register("plyRating")} aria-invalid={Boolean(errors.plyRating)} />
              </Field>
              <Field label="Tread depth (NSD, mm)" htmlFor="nsdMm" error={errors.nsdMm}>
                <Input id="nsdMm" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 14.5" {...register("nsdMm")} aria-invalid={Boolean(errors.nsdMm)} />
              </Field>
            </>
          ) : null}
          <Field label="Company code" htmlFor="materialCode" error={errors.materialCode} hint="The company's material code, or your own item code. Must be unique.">
            <Input id="materialCode" className="h-11 text-base" autoCapitalize="characters" autoComplete="off" {...register("materialCode")} aria-invalid={Boolean(errors.materialCode)} />
          </Field>
          <Field label="Barcode" htmlFor="barcode" error={errors.barcode} hint="Scan with a USB scanner or type it in.">
            <Input id="barcode" className="h-11 text-base" inputMode="numeric" autoComplete="off" {...register("barcode")} aria-invalid={Boolean(errors.barcode)} />
          </Field>
          <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea id="notes" rows={2} placeholder="Anything to remember about this product" {...register("notes")} />
          </Field>
        </div>
      </section>

      {formError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className={onSaved ? "flex gap-2" : "sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0"}>
        <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={() => (onCancel ? onCancel() : router.back())} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          {editing ? "Save changes" : "Save product"}
        </Button>
      </div>
    </form>
  );
}
