/** When a domain command the server accepted has reached the read. */
import { describe, expect, it } from "vitest";

import type { DomainRow } from "../domain-rows.ts";
import { pendingDomainSettled } from "../pending-domain-change.ts";

function row(overrides: Partial<DomainRow> = {}): DomainRow {
  return {
    domain: "acme.com",
    proved: false,
    proofState: "VERIFIED",
    graceEndsAtMs: null,
    claim: void 0,
    ...overrides,
  };
}

describe("a proof waiting for the read", () => {
  const pending = { domain: "acme.com", kind: "proof" } as const;

  it("is unsettled while the row still reads as unproved", () => {
    expect(pendingDomainSettled({ pending, rows: [row()] })).toBe(false);
  });

  it("settles when the domain reads as proved", () => {
    expect(pendingDomainSettled({ pending, rows: [row({ proved: true })] })).toBe(true);
  });

  it("is unsettled while only another domain is proved", () => {
    expect(
      pendingDomainSettled({
        pending,
        rows: [row(), row({ domain: "other.test", proved: true })],
      }),
    ).toBe(false);
  });
});

describe("a removal waiting for the read", () => {
  const pending = { domain: "acme.com", kind: "removal" } as const;

  it("is unsettled while the row is still there, proved or not", () => {
    expect(pendingDomainSettled({ pending, rows: [row({ proved: true })] })).toBe(false);
  });

  it("settles when the domain is gone from the rows altogether", () => {
    expect(pendingDomainSettled({ pending, rows: [row({ domain: "other.test" })] })).toBe(true);
  });
});
