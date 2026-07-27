import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatMilliseconds,
  formatRate,
  formatRelative,
} from "./format";

describe("formatCount", () => {
  it("writes small counts out in full", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });

  it("abbreviates larger counts", () => {
    expect(formatCount(1_000)).toBe("1k");
    expect(formatCount(1_200)).toBe("1.2k");
    expect(formatCount(1_234_567)).toBe("1.2M");
    expect(formatCount(3_000_000_000)).toBe("3B");
  });

  it("keeps the sign, because counter drift is signed", () => {
    // Over-counted and under-counted are different problems; losing the sign
    // would hide which one this is.
    expect(formatCount(-42)).toBe("-42");
    expect(formatCount(-2_000)).toBe("-2k");
  });
});

describe("formatRate", () => {
  it("keeps a decimal place on low rates", () => {
    expect(formatRate(0)).toBe("0");
    expect(formatRate(1.26)).toBe("1.3");
    expect(formatRate(9.94)).toBe("9.9");
  });

  it("abbreviates high rates like counts", () => {
    expect(formatRate(1500)).toBe("1.5k");
  });
});

describe("formatBytes", () => {
  it("stays in bytes below a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("climbs units", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("formatMilliseconds", () => {
  it("does not let sub-millisecond latency read as zero", () => {
    expect(formatMilliseconds(0.4)).toBe("<1ms");
  });

  it("crosses into seconds", () => {
    expect(formatMilliseconds(250)).toBe("250ms");
    expect(formatMilliseconds(1_500)).toBe("1.5s");
  });
});

describe("formatDuration", () => {
  it("uses the unit an operator would say", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(300)).toBe("5m");
    expect(formatDuration(7_200)).toBe("2h");
    expect(formatDuration(172_800)).toBe("2d");
  });
});

describe("formatRelative", () => {
  it("reads as 'just now' immediately after a refresh", () => {
    const now = new Date("2026-01-02T03:04:05Z");
    expect(formatRelative(now, now)).toBe("just now");
  });

  it("reads as an age once time has passed", () => {
    const now = new Date("2026-01-02T03:04:05Z");
    const then = new Date(now.getTime() - 600_000);
    expect(formatRelative(then, now)).toBe("10m ago");
  });
});

describe("formatDateTime", () => {
  it("falls back to the server's own text when it cannot be parsed", () => {
    // Better than rendering an em dash and losing the only information there was.
    expect(formatDateTime("not a date")).toBe("not a date");
  });
});
