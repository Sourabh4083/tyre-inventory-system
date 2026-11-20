"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { LoaderCircle, Save } from "lucide-react";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import type { ProductDTO } from "@/lib/services/products";
import type { ProductCreateInput } from "@/lib/validation/schemas";
import { UNITS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { CONSTRUCTIONS, FITMENTS, TUBE_TYPES, VEHICLE_TYPES, buildTyreName, parseTyreSize, sizeSearchKey } from "@/lib/tyre";
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
  // A new tyre's name is written from its details until someone types a name of their own.
  const [nameTouched, setNameTouched] = useState(editing);

  // Text typed in a search box that looks like a size ("185/65 R15") starts the tyre size too.
  const sizeFromSearch = !editing && defaultName && sizeSearchKey(defaultName) ? defaultName : "";
  const firstCategory = categories.find((c) => c.isTyre) ?? categories[0];

  const form = useForm<FormValues>({
    defaultValues: {
      name: product?.name ?? (sizeFromSearch ? "" : (defaultName ?? "")),
      categoryId: product?.categoryId ?? firstCategory?.id ?? "",
      sellingPrice: product?.sellingPrice ?? "",
      costPrice: product?.costPrice ?? "",
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

  const autoName = buildTyreName({
    tyreSize: parseTyreSize(tyreSize)?.size ?? tyreSize,
    brand,
    pattern,
    tubeType: (tubeType || null) as ProductDTO["tubeType"],
    plyRating: plyRating ? Number(plyRating) : null,
  });

  // Keep the name in step with the tyre details until it is typed by hand.
  useEffect(() => {
    if (isTyre && !nameTouched) setValue("name", autoName);
  }, [isTyre, nameTouched, autoName, setValue]);

  /** Tidy the typed size and fill in radial/bias and ply rating when they can be read from it. */
  const onSizeBlur = () => {
    const parsed = parseTyreSize(getValues("tyreSize"));
    if (!parsed) return;
    setValue("tyreSize", parsed.size);
    if (!getValues("construction") && parsed.construction) setValue("construction", parsed.construction);
    if (!getValues("plyRating") && parsed.plyRating) setValue("plyRating", String(parsed.plyRating));
  };

  const onSubmit = (values: FormValues) => {
    setServerErrors({});
    setFormError(null);
    if (!values.name.trim()) {
      setServerErrors(isTyre ? { tyreSize: "Enter the tyre size, e.g. 185/65 R15." } : { name: "Product name is required." });
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
      unit: values.unit as ProductCreateInput["unit"],
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Basic information</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="categoryId" required error={errors.categoryId}>
            <NativeSelect
              id="categoryId"
              className="h-11"
              {...register("categoryId", { required: "Select a category." })}
              aria-invalid={Boolean(errors.categoryId)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Unit" htmlFor="unit" error={errors.unit}>
            <NativeSelect id="unit" className="h-11" {...register("unit")}>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {isTyre ? (
            <>
              <Field label="Tyre size" htmlFor="tyreSize" required error={errors.tyreSize} hint="Any way you type it: 185/65 R15, 1856515, 10.00-20, 100/90-17">
                <Input
                  id="tyreSize"
                  className="h-11 font-mono text-base"
                  placeholder="e.g. 185/65 R15"
                  autoFocus={!editing}
                  autoCapitalize="characters"
                  autoComplete="off"
                  {...register("tyreSize", { onBlur: onSizeBlur })}
                  aria-invalid={Boolean(errors.tyreSize)}
                />
              </Field>
              <Field label="Vehicle" htmlFor="vehicleType" error={errors.vehicleType}>
                <NativeSelect id="vehicleType" className="h-11" {...register("vehicleType")}>
                  <option value="">Not set</option>
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Brand" htmlFor="brand" error={errors.brand}>
                <Input id="brand" className="h-11 text-base" placeholder="e.g. JK Tyre" {...register("brand")} />
              </Field>
              <Field label="Pattern / model" htmlFor="pattern" error={errors.pattern}>
                <Input id="pattern" className="h-11 text-base" placeholder="e.g. UX Royale" {...register("pattern")} />
              </Field>
              <Field label="Tubeless or tube type" htmlFor="tubeType" error={errors.tubeType}>
                <NativeSelect id="tubeType" className="h-11" {...register("tubeType")}>
                  <option value="">Not set</option>
                  {TUBE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} ({t.short})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          ) : null}

          <Field
            label="Product name"
            htmlFor="name"
            required
            error={errors.name}
            className="sm:col-span-2"
            hint={isTyre && !nameTouched ? "Written from the tyre details. Type here to change it." : undefined}
          >
            <Input
              id="name"
              className="h-11 text-base"
              placeholder={isTyre ? "Fills in from the size, brand and pattern" : "e.g. Tube 90/90-12"}
              autoFocus={!editing && !isTyre}
              {...register("name", { onChange: () => setNameTouched(true) })}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>

          {isOwner ? (
            <>
              <Field label={`Selling price (${currencySymbol})`} htmlFor="sellingPrice" error={errors.sellingPrice}>
                <Input id="sellingPrice" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 5950" {...register("sellingPrice")} aria-invalid={Boolean(errors.sellingPrice)} />
              </Field>
              <Field label={`Cost price (${currencySymbol})`} htmlFor="costPrice" error={errors.costPrice} hint="Only the owner can see and change cost price.">
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
        </div>
      </section>

      {isTyre ? (
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
          <h2 className="font-heading text-lg">Tyre details</h2>
          <p className="mt-1 text-sm text-muted-foreground">Optional. They help filter the stock list and match the company price list.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Radial or bias" htmlFor="construction" error={errors.construction} hint="Read from the size when it says R or -.">
              <NativeSelect id="construction" className="h-11" {...register("construction")}>
                <option value="">Not set</option>
                {CONSTRUCTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Fitment" htmlFor="fitment" error={errors.fitment}>
              <NativeSelect id="fitment" className="h-11" {...register("fitment")}>
                <option value="">Not set</option>
                {FITMENTS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Ply rating (PR)" htmlFor="plyRating" error={errors.plyRating}>
              <Input id="plyRating" className="h-11 text-base" inputMode="numeric" placeholder="e.g. 16" {...register("plyRating")} aria-invalid={Boolean(errors.plyRating)} />
            </Field>
            <Field label="Tread depth (NSD, mm)" htmlFor="nsdMm" error={errors.nsdMm}>
              <Input id="nsdMm" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 14.5" {...register("nsdMm")} aria-invalid={Boolean(errors.nsdMm)} />
            </Field>
            <Field label="Material code" htmlFor="materialCode" error={errors.materialCode} hint="The company's code, if you have it.">
              <Input id="materialCode" className="h-11 font-mono text-base" autoCapitalize="characters" {...register("materialCode")} aria-invalid={Boolean(errors.materialCode)} />
            </Field>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Identification</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SKU" htmlFor="sku" error={errors.sku} hint="Optional. Must be unique if entered.">
            <Input id="sku" className="h-11 font-mono text-base" placeholder="e.g. JK-1856515-UXR" autoCapitalize="characters" {...register("sku")} aria-invalid={Boolean(errors.sku)} />
          </Field>
          <Field label="Barcode" htmlFor="barcode" error={errors.barcode} hint="Optional. Scan with a USB scanner or type it in.">
            <Input id="barcode" className="h-11 font-mono text-base" inputMode="numeric" placeholder="e.g. 8901234567890" {...register("barcode")} aria-invalid={Boolean(errors.barcode)} />
          </Field>
          <Field label="Location" htmlFor="location" error={errors.location} hint="Rack, shelf or godown.">
            <Input id="location" className="h-11 text-base" placeholder="e.g. Rack A2" {...register("location")} />
          </Field>
          {isOwner ? (
            <Field label="Low stock threshold (override)" htmlFor="lowStockThreshold" error={errors.lowStockThreshold} hint={`Leave blank to use the shop-wide threshold (${globalThreshold}).`}>
              <Input id="lowStockThreshold" className="h-11 text-base" inputMode="numeric" placeholder={String(globalThreshold)} {...register("lowStockThreshold")} aria-invalid={Boolean(errors.lowStockThreshold)} />
            </Field>
          ) : null}
        </div>
      </section>

      {!editing && !hideStartingStock ? (
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
          <h2 className="font-heading text-lg">Starting stock</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How many are on hand right now? An <span className="font-medium">initial stock</span> entry is recorded if this is above zero.
          </p>
          <div className="mt-4 max-w-xs">
            <Field label="Starting quantity" htmlFor="startingQuantity" required error={errors.startingQuantity}>
              <QuantityStepper id="startingQuantity" min={0} value={startingQuantity} onChange={(v) => setValue("startingQuantity", v)} />
            </Field>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Description" htmlFor="description" error={errors.description}>
            <Textarea id="description" rows={3} placeholder="Anything else about this product..." {...register("description")} />
          </Field>
          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" rows={2} placeholder="Internal notes (supplier, reorder hints...)" {...register("notes")} />
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
