import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJkRows, readJkPriceList } from "@/lib/price-list/jk";

const list = readJkPriceList(readFileSync("data/Price List Oct-26.xlsx"));
const at = (line: number) => list.rows.find((r) => r.line === line);

describe("JK price list (Oct-26 file)", () => {
  it("reads every table of the file", () => {
    const count = (v: string) => list.rows.filter((r) => r.vehicleType === v).length;
    expect(list.rows.length).toBe(479);
    expect(count("TRUCK_BUS")).toBe(79);
    expect(count("LCV_SCV")).toBe(77);
    expect(count("CAR_JEEP")).toBe(123);
    expect(count("TWO_WHEELER")).toBe(118);
    expect(count("THREE_WHEELER")).toBe(13);
    expect(count("TRACTOR")).toBe(69);
    // The only problem is the company's own repeated row.
    expect(list.problems).toEqual([expect.objectContaining({ line: 270, reason: expect.stringContaining("Same tyre as row 269") })]);
  });

  it("truck bias: prices per tyre, MSRP per pair halved, pattern carried down", () => {
    expect(at(4)).toMatchObject({ size: "7.50-20", plyRating: 12, pattern: "JET R MILES", tubeType: "TTF", ndp: "9565", purchase: "10805", nlc: "10616", msrp: "11250" });
    expect(at(5)).toMatchObject({ size: "8.25-20", plyRating: 16, pattern: "JET R MILES" });
    expect(at(59)).toMatchObject({ size: "11R22.5", plyRating: 16, pattern: "JUH" });
  });

  it("LCV and SCV: ply rating inside the pattern, NSD, fitment", () => {
    expect(at(163)).toMatchObject({ size: "7.00R15", plyRating: 12, pattern: "STEEL KING", nsdMm: 11, fitment: "ALL" });
    expect(at(164)).toMatchObject({ pattern: "STEEL KING LV", plyRating: 12 });
    expect(at(115)).toMatchObject({ size: "145R12", pattern: "ULTIMA XPC TL", tubeType: "TL", nlc: "2888" });
  });

  it("car: tube type and variants such as Puncture Guard, no NLC in the list", () => {
    expect(at(195)).toMatchObject({ vehicleType: "CAR_JEEP", size: "165/80 R14", pattern: "UX ROYALE PUNCTURE GUARD", tubeType: "TL", ndp: "3916", purchase: "4485", nlc: null, msrp: "5150" });
    expect(at(235)).toMatchObject({ pattern: "ULTIMA HI^LIFE", tubeType: "TT", ndp: "2544" });
    expect(at(236)).toMatchObject({ pattern: "ULTIMA HI^LIFE", tubeType: "TL", ndp: "2246" });
  });

  it("2W: G read back as 9 in sizes and prices; size carried down", () => {
    expect(at(340)).toMatchObject({ vehicleType: "TWO_WHEELER", size: "120/80-16", pattern: "Blaze RYDR BR41", fitment: "REAR", tubeType: "TL", purchase: "1947", msrp: null });
    expect(at(357)).toMatchObject({ size: "100/90-17", pattern: "Blaze BR23" });
    expect(at(344)).toMatchObject({ size: "3.00-17", pattern: "Blaze BR22" });
    expect(at(474)).toMatchObject({ size: "3.00-10", tubeType: "TT", ndp: "956", purchase: "999" });
    expect(list.ocrFixes).toBeGreaterThan(50);
  });

  it("tractor: company material codes", () => {
    expect(at(506)).toMatchObject({ vehicleType: "TRACTOR", size: "6.00-16", plyRating: 8, pattern: "SHRESTH PLUS", fitment: "FRONT", materialCode: "16121600160080SHP0", nlc: "3987", msrp: "4302" });
    expect(at(549)).toMatchObject({ size: "8-18", plyRating: 4, fitment: "REAR" });
    expect(at(570)).toMatchObject({ size: "9.00-16", plyRating: 14, tubeType: "TT" });
  });

  it("every row has its own key", () => {
    expect(new Set(list.rows.map((r) => r.key)).size).toBe(list.rows.length);
  });
});

describe("parseJkRows", () => {
  it("reports a price it cannot read instead of guessing", () => {
    const parsed = parseJkRows([
      ["JK TYRE & INDUSTRIES LTD. TRUCK/BUS BIAS NET LANDING COST (NLC) | MSRP"],
      ["S.No.", "Pattern", "Brand", "Size", "NDP (TTF)", "NLC / Tyre", "MSRP / Pair"],
      [1, "Rib", "JET R MILES", "7.50-20 12PR", "9,565", "abc", 22500],
      [2, "", "", "8.25-20 16PR", 11425, 12686, 26900],
    ]);
    expect(parsed.problems).toEqual([expect.objectContaining({ line: 3, reason: "A price could not be read." })]);
    expect(parsed.rows).toEqual([expect.objectContaining({ line: 4, pattern: "JET R MILES", ndp: "11425", msrp: "13450" })]);
  });
});
