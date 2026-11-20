"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Disc3, LoaderCircle, Plus, Tags } from "lucide-react";
import { createCategoryAction, setCategoryIsTyreAction } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; isTyre: boolean };

export function CategoryManager({ categories }: { categories: Category[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [isTyre, setIsTyre] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCategoryAction({ name, isTyre });
      if (!res.ok) return setError(res.fieldErrors?.name ?? res.error);
      toast.success(`Category "${res.data.name}" added`);
      setName("");
    });
  };

  const toggleTyre = (c: Category) => {
    setSavingId(c.id);
    start(async () => {
      const res = await setCategoryIsTyreAction({ id: c.id, isTyre: !c.isTyre });
      setSavingId(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.isTyre ? `"${c.name}" is a tyre category: products need a size` : `"${c.name}" is no longer a tyre category`);
    });
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <Tags className="size-4.5 text-primary" /> Product categories
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Categories are product types: tyres, tubes, flaps, alloy wheels and so on. Which vehicle a tyre fits is set on the tyre itself. Tap a category to
        mark it as a <span className="font-medium text-foreground">tyre category</span>: its products need a tyre size.
      </p>
      <div role="group" aria-label="Tyre categories" className="mt-4 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.isTyre}
            disabled={pending}
            onClick={() => toggleTyre(c)}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-60",
              c.isTyre ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-accent",
            )}
          >
            {savingId === c.id ? <LoaderCircle className="size-4 animate-spin" /> : c.isTyre ? <Disc3 className="size-4" /> : null} {c.name}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <Field label="New category" htmlFor="category-name" error={error ?? undefined} className="flex-1">
          <Input id="category-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alloy Wheels" maxLength={60} aria-invalid={Boolean(error)} />
        </Field>
        <button
          type="button"
          aria-pressed={isTyre}
          onClick={() => setIsTyre((v) => !v)}
          className={cn("flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium", isTyre ? "border-primary bg-primary/10 text-primary" : "bg-background")}
        >
          {isTyre ? <Check className="size-4" /> : null} Tyre category
        </button>
        <Button type="submit" size="lg" className="h-11" disabled={pending || !name.trim()}>
          {pending && !savingId ? <LoaderCircle className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>
    </section>
  );
}
