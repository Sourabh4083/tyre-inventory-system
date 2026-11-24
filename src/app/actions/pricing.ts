"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import { importPriceList, previewPriceList, type ImportPreview, type ImportResult } from "@/lib/services/price-import";

const MAX_BYTES = 12 * 1024 * 1024;

async function readUpload(form: FormData): Promise<{ data: Uint8Array; name: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new AppError("Choose the price list file (.xlsx).");
  if (!/\.xlsx?$/i.test(file.name)) throw new AppError("The price list must be an Excel file (.xlsx).");
  if (file.size > MAX_BYTES) throw new AppError("This file is too big (over 12 MB).");
  return { data: new Uint8Array(await file.arrayBuffer()), name: file.name };
}

/** Reads the uploaded list and shows what an import would change. Saves nothing. */
export async function previewPriceListAction(form: FormData): Promise<ActionResult<ImportPreview>> {
  try {
    const user = await requirePermission("product.price.edit");
    if (user.role !== "OWNER") throw new AppError("Only the owner can import a price list.", "FORBIDDEN");
    const { data, name } = await readUpload(form);
    return { ok: true, data: await previewPriceList(data, name) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function importPriceListAction(form: FormData): Promise<ActionResult<ImportResult>> {
  try {
    const user = await requirePermission("product.price.edit");
    const { data, name } = await readUpload(form);
    const result = await importPriceList(data, name, user);
    for (const path of ["/pricing", "/inventory", "/dashboard", "/activity"]) revalidatePath(path);
    return { ok: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}
