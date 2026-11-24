import * as XLSX from "xlsx";
import type { Fitment, TubeType, VehicleType } from "@/generated/prisma/enums";
import { parseTyreSize } from "@/lib/tyre";

/**
 * Reads the JK Tyre dealer price list (.xlsx converted from the company's PDF).
 *
 * The sheet holds several tables one under another (Truck/Bus, SCV, LCV, Car, 2W/3W,
 * Tractor), each with its own column layout, so columns are found by their header words.
 * The PDF conversion read some 9s as "G" ("1,G47", "G0/G0-17"); those are put back.
 */

export type PriceListRow = {
  /** Spreadsheet row number, as Excel shows it. */
  line: number;
  section: string;
  vehicleType: VehicleType;
  /** Tidy size, e.g. "10.00-20", "185/65 R15". */
  size: string;
  sizeKey: string;
  plyRating: number | null;
  pattern: string;
  tubeType: TubeType | null;
  fitment: Fitment | null;
  nsdMm: number | null;
  materialCode: string | null;
  /** Prices per tyre, as printed (GST included). */
  ndp: string | null;
  purchase: string | null;
  nlc: string | null;
  msrp: string | null;
  /** Stable key of this list row, saved on the product so the next list finds it again. */
  key: string;
};

export type PriceListProblem = { line: number; text: string; reason: string };

export type ParsedPriceList = {
  rows: PriceListRow[];
  problems: PriceListProblem[];
  /** How many cells had a "G" read back as a 9. */
  ocrFixes: number;
};

export const PRICE_LIST_BRAND = "JK Tyre";

type Cell = string | number | null | undefined;
type Columns = {
  size?: number;
  pattern?: number;
  type?: number;
  fitment?: number;
  nsd?: number;
  code?: number;
  ndp?: number;
  purchase?: number;
  nlc?: number;
  msrp?: number;
  msrpPerPair?: boolean;
  /** Tube type said in the NDP header, e.g. "NDP (TTF)". */
  ndpTube?: TubeType;
};

const clean = (c: Cell) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim());

/** "G" next to a digit, dot, slash or dash is a misread 9. */
const OCR_G = /(?<=[\d./-])G|G(?=[\d./-])/g;

/** Reads a price cell: a number, "1,G47" (→ 1947), "-" or blank (→ null). */
function readMoney(c: Cell, fix: () => void): string | null | undefined {
  if (typeof c === "number") return Number.isFinite(c) && c > 0 ? String(c) : null;
  let s = clean(c);
  if (!s || s === "-" || s === "–") return null;
  if (/G/.test(s)) {
    s = s.replace(/G/g, "9");
    fix();
  }
  s = s.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s) > 0 ? String(Number(s)) : null;
}

const half = (v: string | null) => (v == null ? null : String(Math.round(Number(v) * 50) / 100));

function headerColumns(row: Cell[]): Columns | null {
  const cols: Columns = {};
  row.forEach((raw, i) => {
    const h = clean(raw).toUpperCase();
    if (!h) return;
    if (h === "SIZE" || /^SCV (BIAS|RADIAL)$/.test(h)) cols.size ??= i;
    else if (h === "BRAND" || h === "SUB-BRAND") cols.pattern ??= i;
    else if (h === "TYPE") cols.type ??= i;
    else if (h === "FITMENT") cols.fitment ??= i;
    else if (h.startsWith("NSD")) cols.nsd ??= i;
    else if (h.includes("MATERIAL CODE")) cols.code ??= i;
    else if (h === "SET NDP" || h === "TOTAL NDP") cols.ndp = i; // tyre + tube, wins over the tyre-only NDP
    else if (/^NDP( \((TTF|TT|TL)\)| TYRE)?$/.test(h)) {
      cols.ndp ??= i;
      const t = h.match(/\((TTF|TT|TL)\)/)?.[1] as TubeType | undefined;
      if (t) cols.ndpTube = t;
    } else if (/^INVOICE( VALUE)?( \/ TYRE)?$/.test(h)) cols.purchase ??= i;
    else if (h === "NLC" || h === "NLC / TYRE") cols.nlc ??= i;
    else if (h === "MSRP / PAIR") {
      cols.msrp ??= i;
      cols.msrpPerPair = true;
    } else if (/^(MSRP|MRSP|MOP)\b/.test(h)) cols.msrp ??= i;
  });
  return cols.size !== undefined && cols.ndp !== undefined ? cols : null;
}

/** What a title row says about the tables below it. */
function readTitle(text: string): { vehicle?: VehicleType; tube?: TubeType | null; fitment?: Fitment | null } | null {
  const t = text.toUpperCase();
  if (/TRUCK\/BUS/.test(t)) return { vehicle: "TRUCK_BUS", tube: null, fitment: null };
  if (/\b(SCV|LCV)\b/.test(t)) return { vehicle: "LCV_SCV", tube: null, fitment: null };
  if (/CAR & JEEP|PUNCTURE GUARD|SMART TYRE|LEVITAS/.test(t)) return { vehicle: "CAR_JEEP", tube: null, fitment: null };
  if (/MOTORCYCLE|SCOOTER/.test(t)) return { vehicle: "TWO_WHEELER", tube: /TUBELESS/.test(t) ? "TL" : /TUBE ?TYPE/.test(t) ? "TT" : null, fitment: null };
  if (/\b3W\b|RICKSHAW/.test(t) && !/2W AND 3W/.test(t)) return { vehicle: "THREE_WHEELER", tube: null, fitment: null };
  if (/^TRACTOR|FARM/.test(t)) return { vehicle: "TRACTOR", tube: null, fitment: /FRONT/.test(t) ? "FRONT" : /REAR/.test(t) ? "REAR" : null };
  return null;
}

// "185/65 R15", "295/95D20", "10.00-20", "8-18", "145R12", "11R22.5".
const SIZE_TOKEN = /(\d{2,3}(?:\.\d{1,2})?\s*\/\s*\d{2,3}\s*(?:Z?R|D|-)?\s*\d{1,2}(?:\.\d)?|\d{1,3}(?:\.\d{1,2})?\s*(?:R|D|-)\s*\d{1,2}(?:\.\d)?)/;

/** Size cell → size, ply, and any front/rear or tube words written next to it. */
function readSize(cell: string, fix: () => void) {
  let s = cell.toUpperCase().replace(/_/g, " ");
  if (OCR_G.test(s)) {
    s = s.replace(OCR_G, "9");
    fix();
  }
  const token = s.match(SIZE_TOKEN)?.[1];
  const parsed = token ? parseTyreSize(token) : null;
  if (!parsed) return null;
  const rest = s.replace(token!, " ");
  return {
    parsed,
    ply: Number(rest.match(/(\d{1,2})\s*PR\b/)?.[1]) || null,
    fitment: /\bFRONT\b|\(F\)/.test(rest) ? ("FRONT" as const) : /\bREAR\b|\(R\)/.test(rest) ? ("REAR" as const) : null,
    tube: /\bTTF\b/.test(rest) ? ("TTF" as const) : /\bTT\b/.test(rest) ? ("TT" as const) : /\bTL\b/.test(rest) ? ("TL" as const) : null,
  };
}

function readFitmentCell(text: string): { fitment: Fitment | null; tube: TubeType | null } {
  const t = text.toUpperCase();
  return {
    fitment: /FRONT/.test(t) ? "FRONT" : /REAR/.test(t) ? "REAR" : /ALL WHEEL/.test(t) ? "ALL" : null,
    tube: /\bTL\b/.test(t) ? "TL" : /\bTT\b/.test(t) ? "TT" : null,
  };
}

export function priceListKey(r: Pick<PriceListRow, "sizeKey" | "pattern" | "plyRating" | "tubeType" | "fitment">): string {
  const pattern = r.pattern.toUpperCase().replace(/[^A-Z0-9+]+/g, " ").trim();
  return ["JK", r.sizeKey, pattern, r.plyRating ?? "", r.tubeType ?? "", r.fitment ?? ""].join("|");
}

/** Reads the sheet's rows (arrays of cells). Exported for tests. */
export function parseJkRows(rows: Cell[][]): ParsedPriceList {
  const out: PriceListRow[] = [];
  const problems: PriceListProblem[] = [];
  let ocrFixes = 0;
  const fix = () => {
    ocrFixes++;
  };

  let cols: Columns | null = null;
  let section = "";
  let vehicle: VehicleType | null = null;
  let sectionTube: TubeType | null = null;
  let sectionFitment: Fitment | null = null;
  let lastSize: ReturnType<typeof readSize> = null;
  let lastPattern = "";
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 1;
    const cells = row.map(clean);
    const text = cells.filter(Boolean).join(" | ");
    if (!text) return;

    const header = headerColumns(row);
    if (header) {
      cols = header;
      lastSize = null;
      lastPattern = "";
      return;
    }

    // A title row (few cells, no prices) starts a new table or names the one below.
    const firstWords = cells[0] ?? "";
    const title = readTitle(firstWords);
    if (title && cells.filter(Boolean).length <= 4) {
      if (title.vehicle) vehicle = title.vehicle;
      sectionTube = title.tube ?? null;
      sectionFitment = title.fitment ?? null;
      section = firstWords.replace(/JK TYRE . INDUSTRIES LTD\.?/i, "").replace(/\s{2,}.*$/, "").trim() || section;
      cols = /PRICE LIST|NET LANDING|INVOICE PRICE/i.test(firstWords) ? null : cols;
      lastSize = null;
      lastPattern = "";
      return;
    }
    if (!cols || !vehicle) return;
    const c: Columns = cols;

    const at = (i?: number) => (i === undefined ? "" : (cells[i] ?? ""));
    const money = (i?: number) => (i === undefined ? null : readMoney(row[i], fix));
    const ndp = money(c.ndp);
    const purchase = money(c.purchase);
    const nlc = money(c.nlc);
    const msrpRaw = money(c.msrp);
    const prices = [ndp, purchase, nlc, msrpRaw];
    if (prices.every((p) => p === null)) return; // notes, footers, blank lines

    // Size and pattern carry down to the rows below even when this row has a problem.
    const sizeCell = at(c.size);
    const size = sizeCell ? readSize(sizeCell, fix) : lastSize;
    if (size) lastSize = size;
    let pattern = at(c.pattern) || lastPattern;
    lastPattern = pattern;

    if (prices.some((p) => p === undefined)) {
      problems.push({ line, text, reason: "A price could not be read." });
      return;
    }
    if (!size) {
      problems.push({ line, text, reason: sizeCell ? `Size "${sizeCell}" could not be read.` : "No size on this row." });
      return;
    }
    if (!pattern) {
      problems.push({ line, text, reason: "No pattern (brand) on this row." });
      return;
    }
    // "STEEL KING 12PR_LV": the ply rating goes to its own field, underscores become spaces.
    pattern = pattern.replace(/_/g, " ");
    const plyWords = /\b(\d{1,2}) ?PR\b/i;
    const plyInPattern = Number(pattern.match(plyWords)?.[1]) || null;
    pattern = pattern.replace(plyWords, " ").replace(/\s+/g, " ").trim();

    // Car list "Type": TL / TUBE-TYPE, or a variant such as PUNCTURE GUARD that is part of the name.
    let tubeType: TubeType | null = size.tube;
    const type = at(c.type).toUpperCase();
    if (type) {
      if (/TUBE-?TYPE/.test(type)) tubeType = "TT";
      else tubeType = "TL";
      const variant = type.replace(/\bTL\b|TUBE-?TYPE/g, "").trim();
      if (variant) pattern = `${pattern} ${variant}`;
    }
    const fit = readFitmentCell(at(c.fitment));
    tubeType ??= fit.tube ?? (/\bTL\b/i.test(pattern) ? "TL" : null) ?? sectionTube ?? c.ndpTube ?? null;
    const fitment = size.fitment ?? fit.fitment ?? sectionFitment;
    const nsdMm = Number(at(c.nsd)) || null;
    const materialCode = at(c.code) || null;
    const plyRating = size.ply ?? size.parsed.plyRating ?? plyInPattern;

    const r: PriceListRow = {
      line,
      section,
      vehicleType: vehicle,
      size: size.parsed.size,
      sizeKey: size.parsed.key,
      plyRating,
      pattern: pattern.replace(/\s+/g, " "),
      tubeType,
      fitment,
      nsdMm,
      materialCode,
      ndp: ndp ?? null,
      purchase: purchase ?? null,
      nlc: nlc ?? null,
      msrp: c.msrpPerPair ? half(msrpRaw ?? null) : (msrpRaw ?? null),
      key: "",
    };
    r.key = materialCode ? `JK|CODE|${materialCode.toUpperCase()}` : priceListKey(r);
    const earlier = seen.get(r.key);
    if (earlier !== undefined) {
      problems.push({ line, text, reason: `Same tyre as row ${earlier}; only the first is used.` });
      return;
    }
    seen.set(r.key, line);
    out.push(r);
  });

  return { rows: out, problems, ocrFixes };
}

/** Reads an uploaded .xlsx file. */
export function readJkPriceList(data: ArrayBuffer | Uint8Array): ParsedPriceList {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], problems: [{ line: 0, text: "", reason: "The file has no sheets." }], ocrFixes: 0 };
  const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, defval: "", raw: true });
  return parseJkRows(rows);
}
