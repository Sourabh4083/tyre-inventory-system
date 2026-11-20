import type { Fitment, TubeType, TyreConstruction, VehicleType } from "@/generated/prisma/enums";

/* ---------- Labels ---------- */

export const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: "CAR_JEEP", label: "Car & Jeep" },
  { value: "TWO_WHEELER", label: "Two-wheeler" },
  { value: "THREE_WHEELER", label: "Three-wheeler" },
  { value: "LCV_SCV", label: "LCV / SCV" },
  { value: "TRUCK_BUS", label: "Truck & Bus" },
  { value: "TRACTOR", label: "Tractor" },
  { value: "OTHER", label: "Other" },
];
export const VEHICLE_TYPE_LABEL = Object.fromEntries(VEHICLE_TYPES.map((v) => [v.value, v.label])) as Record<VehicleType, string>;

export const TUBE_TYPES: { value: TubeType; label: string; short: string }[] = [
  { value: "TL", label: "Tubeless", short: "TL" },
  { value: "TT", label: "Tube type", short: "TT" },
  { value: "TTF", label: "Tube type + flap", short: "TTF" },
];
export const TUBE_TYPE_LABEL = Object.fromEntries(TUBE_TYPES.map((v) => [v.value, v.label])) as Record<TubeType, string>;

export const CONSTRUCTIONS: { value: TyreConstruction; label: string }[] = [
  { value: "RADIAL", label: "Radial" },
  { value: "BIAS", label: "Bias (nylon)" },
];
export const CONSTRUCTION_LABEL: Record<TyreConstruction, string> = { RADIAL: "Radial", BIAS: "Bias" };

export const FITMENTS: { value: Fitment; label: string }[] = [
  { value: "ALL", label: "All wheel" },
  { value: "FRONT", label: "Front" },
  { value: "REAR", label: "Rear" },
];
export const FITMENT_LABEL = Object.fromEntries(FITMENTS.map((v) => [v.value, v.label])) as Record<Fitment, string>;

/* ---------- Tyre size ---------- */

export type ParsedSize = {
  /** Tidy form to store and show, e.g. "185/65 R15", "10.00-20", "100/90-17". */
  size: string;
  /** Digits only ("1856515"): the same tyre however the size was typed. */
  key: string;
  rimInch: number | null;
  construction: TyreConstruction | null;
  plyRating: number | null;
};

/**
 * Reads a tyre size the way staff type it: "185/65 R15", "185/65r15", "185 65 15", "1856515",
 * "10.00-20 16PR", "295/90R20", "100/90-17", "12.4-28", "165D12". Returns null for blank input.
 * A ply rating in the size ("16PR") is split off. Seven bare digits are read as a car size.
 */
export function parseTyreSize(raw: string | null | undefined): ParsedSize | null {
  let s = (raw ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;

  let plyRating: number | null = null;
  const ply = s.match(/\b(\d{1,2})\s*PR\b/);
  if (ply) {
    plyRating = Number(ply[1]);
    s = s.replace(ply[0], " ").replace(/\s+/g, " ").trim();
  }

  // Metric car/SUV sizes typed loosely: "1856515", "185 65 15", "185/65r15", "185/65 ZR15".
  // ZR can also go at the end of the short form ("2254517ZR", "2254517 ZR"), and a load/speed
  // index after the size ("225/45R17 94W") is kept. Bare digits mean an ordinary R tyre.
  const indexMatch = s.match(/\s+(\d{2,3}(?:\/\d{2,3})?[A-Z])$/);
  const head = indexMatch ? s.slice(0, indexMatch.index) : s;
  const metric = head.match(/^(\d{3})\s*[/ ]?\s*(\d{2})\s*(Z?R)?\s*(\d{2})(?:\s*(ZR))?$/);
  const bareDigits = /^\d{7}$/.test(head) || /^\d{3}[ /]\d{2} \d{2}$/.test(head);
  if (metric && (metric[3] || metric[5] || bareDigits)) {
    const [, width, aspect, rTyped, rim, zrAfter] = metric;
    const zr = rTyped === "ZR" || Boolean(zrAfter);
    s = `${width}/${aspect} ${zr ? "ZR" : "R"}${rim}${indexMatch ? ` ${indexMatch[1]}` : ""}`;
    return { size: s, key: `${width}${aspect}${rim}`, rimInch: Number(rim), construction: "RADIAL", plyRating };
  } else {
    // Tidy spacing around separators: "10.00 - 20" -> "10.00-20", "185 / 65" -> "185/65".
    s = s.replace(/\s*([/-])\s*/g, "$1");
  }

  const rimMatch = s.match(/(?:Z?R|D|-|\s)\s*(\d{1,2}(?:\.\d)?)$/);
  const rimInch = rimMatch ? Number(rimMatch[1]) : null;

  let construction: TyreConstruction | null = null;
  if (/\d\s*Z?R\s*\d/.test(s)) construction = "RADIAL";
  else if (/\d\s*D\s*\d/.test(s) || /\d-\d/.test(s)) construction = "BIAS";

  return { size: s, key: s.replace(/\D/g, ""), rimInch, construction, plyRating };
}

/**
 * The digits to look for when a search box holds something that looks like a size
 * ("185/65 r15", "1856515", "10.00-20"); null for ordinary words.
 */
export function sizeSearchKey(query: string): string | null {
  const q = query.trim();
  if (!/^[\d\s./\-*xXrRdDzZ]+$/.test(q)) return null;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

/* ---------- Vehicle number ---------- */

/** "cg-04 ab 1234" -> "CG 04 AB 1234" style: capitals, single spaces. */
export function tidyVehicleNumber(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z0-9 -]/g, "").replace(/[\s-]+/g, " ").trim();
  return s || null;
}

/** Letters and digits only, for matching however the number was typed. */
export function vehicleKey(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || null;
}

/* ---------- Display ---------- */

type TyreBits = {
  tyreSize?: string | null;
  brand?: string | null;
  pattern?: string | null;
  tubeType?: TubeType | null;
  construction?: TyreConstruction | null;
  fitment?: Fitment | null;
  plyRating?: number | null;
  nsdMm?: string | number | null;
};

/** The name a new tyre gets from its details: "185/65 R15 JK Tyre UX Royale TL". */
export function buildTyreName(t: TyreBits): string {
  return [t.tyreSize, t.brand, t.pattern, t.plyRating ? `${t.plyRating}PR` : null, t.tubeType]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join(" ");
}

/** One short line of tyre facts for lists: "Tubeless · Radial · Front · 16PR". */
export function tyreSpecLine(t: TyreBits): string {
  return [
    t.tubeType ? TUBE_TYPE_LABEL[t.tubeType] : null,
    t.construction ? CONSTRUCTION_LABEL[t.construction] : null,
    t.fitment && t.fitment !== "ALL" ? FITMENT_LABEL[t.fitment] : null,
    t.plyRating ? `${t.plyRating}PR` : null,
    t.nsdMm != null && t.nsdMm !== "" ? `${Number(t.nsdMm)} mm NSD` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
