import { describe, expect, it } from "vitest";
import {
  computeLine,
  computeOrder,
  discountBasisPoints,
  discountTier,
  formatPercent,
  formatSdg,
  formatUsd,
  parseRate,
  parseUsdToCents,
  type DiscountThresholds,
} from "./money";

// Thresholds from the brief: sand up to 3%, red up to 5%, blocked above.
const T: DiscountThresholds = { sandMaxBp: 300, redMaxBp: 500 };

describe("parseUsdToCents", () => {
  it("parses whole dollars", () => {
    expect(parseUsdToCents("40")).toBe(4000);
  });
  it("parses dollars and cents without floating point drift", () => {
    expect(parseUsdToCents("0.29")).toBe(29);
    expect(parseUsdToCents("1.1")).toBe(110);
    expect(parseUsdToCents("2,070.55")).toBe(207055);
  });
  it("treats an empty field as zero", () => {
    expect(parseUsdToCents("")).toBe(0);
    expect(parseUsdToCents("  ")).toBe(0);
  });
  it("rejects more than two decimals, negatives and junk", () => {
    expect(parseUsdToCents("1.234")).toBeNull();
    expect(parseUsdToCents("-5")).toBeNull();
    expect(parseUsdToCents("12a")).toBeNull();
    expect(parseUsdToCents("1e3")).toBeNull();
  });
  it("never reads a number as a date", () => {
    expect(parseUsdToCents("1.10")).toBe(110);
    expect(parseUsdToCents("3/4")).toBeNull();
  });
});

describe("parseRate", () => {
  it("accepts whole numbers with thousands separators", () => {
    expect(parseRate("8200")).toBe(8200);
    expect(parseRate("8,200")).toBe(8200);
  });
  it("reads a half-typed number as its digits, so typing 7,900 never flashes an error", () => {
    expect(parseRate("7,9")).toBe(79);
    expect(parseRate("7,90")).toBe(790);
  });
  it("rejects decimals, blanks and junk", () => {
    expect(parseRate("8200.5")).toBeNull();
    expect(parseRate("")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });
});

describe("discountBasisPoints", () => {
  it("rounds to the nearest hundredth of a percent", () => {
    expect(discountBasisPoints(4000, 206000)).toBe(194); // 1.9417%
    expect(discountBasisPoints(7000, 162000)).toBe(432); // 4.3209%
    expect(discountBasisPoints(15000, 207000)).toBe(725); // 7.2463%
  });
  it("is zero for an empty line", () => {
    expect(discountBasisPoints(0, 0)).toBe(0);
  });
});

describe("discountTier", () => {
  it("is none without a discount", () => {
    expect(discountTier(0, 206000, T)).toBe("none");
  });
  it("is sand above 0% and up to exactly 3%", () => {
    expect(discountTier(1, 206000, T)).toBe("sand");
    expect(discountTier(3000, 100000, T)).toBe("sand"); // exactly 3.00%
  });
  it("is red above 3% and up to exactly 5%", () => {
    expect(discountTier(3001, 100000, T)).toBe("red");
    expect(discountTier(5000, 100000, T)).toBe("red"); // exactly 5.00%
  });
  it("is blocked above 5%, judged on exact cents, not the rounded percentage", () => {
    // 5.004% rounds to 5.00% for display but is still above 5%.
    expect(discountTier(5004, 100000, T)).toBe("blocked");
  });
});

describe("computeLine — the worked example", () => {
  it("line 1: 4 × $515, $40 off → $2,060, 1.94%, sand, $2,020", () => {
    expect(computeLine({ unitPriceCents: 51500, quantity: 4, discountCents: 4000 }, T)).toEqual({
      lineValueCents: 206000,
      discountCents: 4000,
      discountBp: 194,
      tier: "sand",
      lineTotalCents: 202000,
    });
  });
  it("line 2: 2 × $810, $70 off → $1,620, 4.32%, red, $1,550", () => {
    expect(computeLine({ unitPriceCents: 81000, quantity: 2, discountCents: 7000 }, T)).toEqual({
      lineValueCents: 162000,
      discountCents: 7000,
      discountBp: 432,
      tier: "red",
      lineTotalCents: 155000,
    });
  });
  it("line 3: 1 × $2,070, $150 off → $2,070, 7.25%, blocked, $1,920", () => {
    expect(computeLine({ unitPriceCents: 207000, quantity: 1, discountCents: 15000 }, T)).toEqual({
      lineValueCents: 207000,
      discountCents: 15000,
      discountBp: 725,
      tier: "blocked",
      lineTotalCents: 192000,
    });
  });
});

describe("computeOrder — the worked example at 8,200", () => {
  const line1 = { unitPriceCents: 51500, quantity: 4, discountCents: 4000 };
  const line2 = { unitPriceCents: 81000, quantity: 2, discountCents: 7000 };
  const line3 = { unitPriceCents: 207000, quantity: 1, discountCents: 15000 };

  it("without line 3: $3,570 = 29,274,000 SDG", () => {
    const o = computeOrder([line1, line2], 8200, T);
    expect(o.totalUsdCents).toBe(357000);
    expect(o.totalSdgPiastres).toBe(2927400000);
    expect(formatUsd(o.totalUsdCents)).toBe("$3,570");
    expect(formatSdg(o.totalSdgPiastres)).toBe("29,274,000 SDG");
  });
  it("with line 3: $5,490 = 45,018,000 SDG", () => {
    const o = computeOrder([line1, line2, line3], 8200, T);
    expect(o.totalUsdCents).toBe(549000);
    expect(o.totalSdgPiastres).toBe(4501800000);
    expect(formatUsd(o.totalUsdCents)).toBe("$5,490");
    expect(formatSdg(o.totalSdgPiastres)).toBe("45,018,000 SDG");
  });
  it("reports which lines are blocked", () => {
    expect(computeOrder([line1, line2, line3], 8200, T).blockedLineIndexes).toEqual([2]);
    expect(computeOrder([line1, line2], 8200, T).blockedLineIndexes).toEqual([]);
  });
});

describe("computeLine — invalid input", () => {
  it("refuses a discount larger than the line", () => {
    expect(() => computeLine({ unitPriceCents: 100, quantity: 1, discountCents: 101 }, T)).toThrow();
  });
  it("refuses a zero or fractional quantity", () => {
    expect(() => computeLine({ unitPriceCents: 100, quantity: 0, discountCents: 0 }, T)).toThrow();
    expect(() => computeLine({ unitPriceCents: 100, quantity: 1.5, discountCents: 0 }, T)).toThrow();
  });
});

describe("formatting", () => {
  it("shows cents only when there are any", () => {
    expect(formatUsd(202000)).toBe("$2,020");
    expect(formatUsd(202050)).toBe("$2,020.50");
    expect(formatUsd(5)).toBe("$0.05");
  });
  it("shows piastres only when there are any", () => {
    expect(formatSdg(8201)).toBe("82.01 SDG");
  });
  it("formats basis points as a percentage", () => {
    expect(formatPercent(194)).toBe("1.94%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(1250)).toBe("12.50%");
  });
});
