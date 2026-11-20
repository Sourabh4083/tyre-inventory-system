import { describe, expect, it } from "vitest";
import { buildTyreName, parseTyreSize, sizeSearchKey, tidyVehicleNumber, tyreSpecLine, vehicleKey } from "@/lib/tyre";

describe("parseTyreSize", () => {
  it("reads car sizes however they are typed", () => {
    for (const typed of ["185/65 R15", "185/65R15", "185/65r15", "185 65 15", "1856515", " 185 / 65  R 15 "]) {
      expect(parseTyreSize(typed), typed).toEqual({ size: "185/65 R15", key: "1856515", rimInch: 15, construction: "RADIAL", plyRating: null });
    }
  });

  it("keeps ZR sizes", () => {
    expect(parseTyreSize("225/45 zr17")).toMatchObject({ size: "225/45 ZR17", key: "2254517", rimInch: 17, construction: "RADIAL" });
  });

  it("reads truck sizes and splits off the ply rating", () => {
    expect(parseTyreSize("10.00-20 16PR")).toEqual({ size: "10.00-20", key: "100020", rimInch: 20, construction: "BIAS", plyRating: 16 });
    expect(parseTyreSize("10.00R20 16pr")).toEqual({ size: "10.00R20", key: "100020", rimInch: 20, construction: "RADIAL", plyRating: 16 });
    expect(parseTyreSize("295/90R20")).toMatchObject({ size: "295/90 R20", key: "2959020", rimInch: 20, construction: "RADIAL" });
    expect(parseTyreSize("295/95D20")).toMatchObject({ rimInch: 20, construction: "BIAS" });
  });

  it("reads two-wheeler, three-wheeler, LCV and tractor sizes", () => {
    expect(parseTyreSize("100/90-17")).toMatchObject({ size: "100/90-17", key: "1009017", rimInch: 17, construction: "BIAS" });
    expect(parseTyreSize("2.75 - 18")).toMatchObject({ size: "2.75-18", rimInch: 18 });
    expect(parseTyreSize("4.00-8")).toMatchObject({ size: "4.00-8", key: "4008", rimInch: 8 });
    expect(parseTyreSize("165D12")).toMatchObject({ size: "165D12", rimInch: 12, construction: "BIAS" });
    expect(parseTyreSize("7.00R15 12PR")).toMatchObject({ size: "7.00R15", rimInch: 15, construction: "RADIAL", plyRating: 12 });
    expect(parseTyreSize("12.4-28")).toMatchObject({ size: "12.4-28", key: "12428", rimInch: 28 });
  });

  it("returns null for blank input", () => {
    expect(parseTyreSize("")).toBeNull();
    expect(parseTyreSize("   ")).toBeNull();
    expect(parseTyreSize(null)).toBeNull();
  });
});

describe("sizeSearchKey", () => {
  it("turns size-looking searches into digits", () => {
    expect(sizeSearchKey("185/65 r15")).toBe("1856515");
    expect(sizeSearchKey("1856515")).toBe("1856515");
    expect(sizeSearchKey("185 65")).toBe("18565");
    expect(sizeSearchKey("10.00-20")).toBe("100020");
  });

  it("ignores words and very short numbers", () => {
    expect(sizeSearchKey("Royale")).toBeNull();
    expect(sizeSearchKey("UX 185")).toBeNull();
    expect(sizeSearchKey("15")).toBeNull();
  });
});

describe("vehicle number", () => {
  it("tidies and keys the number", () => {
    expect(tidyVehicleNumber(" cg-04  ab 1234 ")).toBe("CG 04 AB 1234");
    expect(vehicleKey("CG 04 AB-1234")).toBe("CG04AB1234");
    expect(tidyVehicleNumber("")).toBeNull();
    expect(vehicleKey("  ")).toBeNull();
  });
});

describe("display", () => {
  it("builds a tyre name from its details", () => {
    expect(buildTyreName({ tyreSize: "185/65 R15", brand: "JK Tyre", pattern: "UX Royale", tubeType: "TL" })).toBe("185/65 R15 JK Tyre UX Royale TL");
    expect(buildTyreName({ tyreSize: "10.00-20", brand: "JK Tyre", pattern: "Jet R Miles", plyRating: 16, tubeType: "TTF" })).toBe("10.00-20 JK Tyre Jet R Miles 16PR TTF");
  });

  it("writes a short spec line", () => {
    expect(tyreSpecLine({ tubeType: "TL", construction: "RADIAL", fitment: "FRONT", plyRating: 16, nsdMm: "14.5" })).toBe("Tubeless · Radial · Front · 16PR · 14.5 mm NSD");
    expect(tyreSpecLine({ fitment: "ALL" })).toBe("");
  });
});

describe("guessVehicleType", () => {
  it("reads the vehicle from category names", async () => {
    const { guessVehicleType } = await import("@/lib/tyre");
    expect(guessVehicleType("Car & Jeep Tyres")).toBe("CAR_JEEP");
    expect(guessVehicleType("Two-Wheeler Tyres")).toBe("TWO_WHEELER");
    expect(guessVehicleType("LCV / SCV Tyres")).toBe("LCV_SCV");
    expect(guessVehicleType("Truck & Bus Tyres")).toBe("TRUCK_BUS");
    expect(guessVehicleType("Tractor Tyres")).toBe("TRACTOR");
    expect(guessVehicleType("Tubes & Flaps")).toBeNull();
  });
});
