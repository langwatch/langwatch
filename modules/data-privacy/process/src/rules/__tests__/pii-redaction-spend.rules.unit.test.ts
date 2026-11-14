import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  piiRedactionCostNanoUsd,
  piiRedactionPriceNanoUsd,
  piiRedactionSpendFact,
  piiRedactionRequestIdKey,
  piiRedactionSpendRequestId,
} from "../pii-redaction-spend.rules.ts";

const KEY = piiRedactionRequestIdKey("test-pepper");

describe("piiRedactionPriceNanoUsd", () => {
  /** @scenario "An answered batch is priced at the published rate per character" */
  it("prices 1,000 characters at 500,000 nano dollars", () => {
    expect(piiRedactionPriceNanoUsd({ characters: 1_000, free: false })).toBe(500_000);
  });

  /** @scenario "An answered batch is priced at the published rate per character" */
  it("prices 100 characters at 0.00005 dollars", () => {
    expect(piiRedactionPriceNanoUsd({ characters: 100, free: false }) / 1e9).toBe(0.00005);
  });

  /** @scenario "A free organization's call is recorded at a price of zero" */
  it("prices a free organization's characters at zero", () => {
    expect(piiRedactionPriceNanoUsd({ characters: 1_000, free: true })).toBe(0);
  });
});

describe("piiRedactionCostNanoUsd", () => {
  it("estimates one second at 7 GB plus the request fee", () => {
    expect(piiRedactionCostNanoUsd({ durationMs: 1_000 })).toBe(93_534);
  });

  it("charges the request fee alone for a call that took no time", () => {
    expect(piiRedactionCostNanoUsd({ durationMs: 0 })).toBe(200);
  });
});

describe("piiRedactionSpendRequestId", () => {
  const base = { key: KEY, projectId: "project_1", texts: ["call Ana"] };

  /** @scenario "The same span redacted twice is one request" */
  it("gives the same id for the same span and texts", () => {
    const first = piiRedactionSpendRequestId({ ...base, recordKey: "trace-1:span-1" });
    const again = piiRedactionSpendRequestId({ ...base, recordKey: "trace-1:span-1" });

    expect(again).toBe(first);
    expect(first).toMatch(/^piiredaction_[0-9a-f]{32}$/);
  });

  /** @scenario "Two spans with the same text are two requests" */
  it("gives different ids to two spans with the same texts", () => {
    expect(piiRedactionSpendRequestId({ ...base, recordKey: "trace-1:span-1" })).not.toBe(
      piiRedactionSpendRequestId({ ...base, recordKey: "trace-1:span-2" }),
    );
  });

  /** @scenario "A batch given no record key is keyed by its own text" */
  it("keys a batch with no record key by the project and the texts", () => {
    const id = piiRedactionSpendRequestId(base);

    expect(piiRedactionSpendRequestId(base)).toBe(id);
    expect(piiRedactionSpendRequestId({ ...base, texts: ["call Bo"] })).not.toBe(id);
    expect(piiRedactionSpendRequestId({ ...base, projectId: "project_2" })).not.toBe(id);
  });

  /** @scenario "The request id cannot be recomputed from a guessed text" */
  it("is not the plain SHA-256 of the project and the texts", () => {
    const plain = createHash("sha256");
    for (const part of [base.projectId, "", ...base.texts]) plain.update(`${part.length}:${part}`);

    expect(piiRedactionSpendRequestId(base)).not.toBe(
      `piiredaction_${plain.digest("hex").slice(0, 32)}`,
    );
  });

  /** @scenario "The request id cannot be recomputed from a guessed text" */
  it("gives another id under another deployment's key", () => {
    expect(
      piiRedactionSpendRequestId({ ...base, key: piiRedactionRequestIdKey("other-pepper") }),
    ).not.toBe(piiRedactionSpendRequestId(base));
  });

  /** @scenario "The request id cannot be recomputed from a guessed text" */
  it("derives a key of its own, never the pepper itself", () => {
    expect(Buffer.from(KEY).toString("utf8")).not.toBe("test-pepper");
    expect(KEY).toHaveLength(32);
  });

  it("does not read two texts joined as one text", () => {
    expect(piiRedactionSpendRequestId({ ...base, texts: ["ab", "c"] })).not.toBe(
      piiRedactionSpendRequestId({ ...base, texts: ["a", "bc"] }),
    );
  });
});

describe("piiRedactionSpendFact", () => {
  /** @scenario "An answered batch is priced at the published rate per character" */
  it("carries the organization, the characters, the texts, the rate version and both amounts", () => {
    expect(
      piiRedactionSpendFact({
        key: KEY,
        organizationId: "org_1",
        projectId: "project_1",
        texts: ["call Ana", "hello"],
        recordKey: "trace-1:span-1",
        durationMs: 1_000,
        free: false,
        occurredAt: 1_700_000_000_000,
      }),
    ).toEqual({
      tenantId: "org_1",
      occurredAt: 1_700_000_000_000,
      organizationId: "org_1",
      projectId: "project_1",
      requestId: piiRedactionSpendRequestId({
        key: KEY,
        projectId: "project_1",
        recordKey: "trace-1:span-1",
        texts: ["call Ana", "hello"],
      }),
      model: "pii-redaction-model",
      rateVersion: "pii_redaction@500nano_per_char",
      characters: 13,
      texts: 2,
      priceNanoUsd: 6_500,
      costNanoUsd: 93_534,
    });
  });
});
