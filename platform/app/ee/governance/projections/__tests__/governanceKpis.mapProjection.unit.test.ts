// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governanceKpis` — the /governance spend stream as a pre-built map
 * (ADR-107 decision 17). The contribution is per-span and keyed by the span
 * id, so a rebuild reproduces the live row exactly (`ReplacingMergeTree`
 * idempotency lives in migrations 00031 + 00063, not tested here).
 */

import type { GovernanceKpiContribution } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { describe, expect, it, vi } from "vitest";
import { canonicalSpan } from "~/server/event-sourcing/trace-processing/__tests__/fixtures";
import {
  createGovernanceKpisMap,
  deriveGovernanceKpiContribution,
} from "../governanceKpis.mapProjection";

const TENANT_ID = "gov-project-1";
const SPAN_START_MS = 1_700_000_000_500;
const HOUR_MS = 60 * 60 * 1000;

const GOVERNANCE_ATTRS = {
  "langwatch.origin.kind": "ingestion_source",
  "langwatch.ingestion_source.id": "is-1",
  "langwatch.ingestion_source.source_type": "claude_compliance",
} as const;

function governanceSpan(overrides: Parameters<typeof canonicalSpan>[0] = {}) {
  return canonicalSpan({
    tenantId: TENANT_ID,
    startTimeUnixMs: SPAN_START_MS,
    occurredAt: SPAN_START_MS,
    ...overrides,
    attributes: { ...GOVERNANCE_ATTRS, ...(overrides.attributes ?? {}) },
  });
}

describe("deriveGovernanceKpiContribution", () => {
  it("contributes the span's own spend and tokens to its (source, hour) bucket", () => {
    const span = governanceSpan({
      spanId: "bbbb0000000000a1",
      cost: { cost: 0.0042, nonBilledCost: null },
      usage: {
        inputTokens: 120,
        outputTokens: 42,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        estimated: false,
      },
    });
    const row = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: SPAN_START_MS,
    });

    expect(row).not.toBeNull();
    expect(row!.tenantId).toBe(TENANT_ID);
    expect(row!.sourceId).toBe("is-1");
    expect(row!.sourceType).toBe("claude_compliance");
    expect(row!.spendUsd).toBe(0.0042);
    expect(row!.promptTokens).toBe(120);
    expect(row!.completionTokens).toBe(42);
  });

  it("keys the contribution on the span id so a re-derivation lands on the same row", () => {
    const span = governanceSpan({ spanId: "bbbb0000000000a1" });
    const row = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: SPAN_START_MS,
    });
    expect(row!.eventId).toBe("bbbb0000000000a1");
  });

  it("floors the bucket to the hour of the span's own start", () => {
    const span = governanceSpan();
    const row = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: SPAN_START_MS,
    });
    expect(row!.hourBucket.getTime() % HOUR_MS).toBe(0);
    expect(row!.hourBucket.getTime()).toBe(
      Math.floor(SPAN_START_MS / HOUR_MS) * HOUR_MS,
    );
  });

  it("versions the row on the span event's own occurredAt, not on wall-clock", () => {
    const span = governanceSpan();
    const row = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: 1_700_000_123_000,
    });
    expect(row!.lastEventOccurredAt.getTime()).toBe(1_700_000_123_000);
  });

  it("is deterministic: re-deriving the same span produces a byte-identical row", () => {
    const span = governanceSpan({
      spanId: "bbbb0000000000a1",
      cost: { cost: 1, nonBilledCost: null },
    });
    const once = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: SPAN_START_MS,
    });
    const twice = deriveGovernanceKpiContribution({
      tenantId: TENANT_ID,
      span,
      occurredAtMs: SPAN_START_MS,
    });
    expect(twice).toEqual(once);
  });

  describe("given a span with no governance origin", () => {
    it("contributes nothing — application traffic is not governance spend", () => {
      const span = canonicalSpan({
        tenantId: TENANT_ID,
        attributes: { "gen_ai.request.model": "gpt-5-mini" },
      });
      expect(
        deriveGovernanceKpiContribution({
          tenantId: TENANT_ID,
          span,
          occurredAtMs: SPAN_START_MS,
        }),
      ).toBeNull();
    });
  });
});

describe("createGovernanceKpisMap", () => {
  it("writes one contribution per governance span in a single batch", async () => {
    const writeBatch = vi.fn().mockResolvedValue(undefined);
    const map = createGovernanceKpisMap({
      store: { kind: "append", writeBatch },
    });

    const result = await map.apply({
      tenantId: TENANT_ID,
      events: [
        {
          type: "lw.obs.trace.span_received",
          data: governanceSpan({ spanId: "bbbb0000000000a1" }),
        },
        {
          type: "lw.obs.trace.span_received",
          data: governanceSpan({ spanId: "bbbb0000000000a2" }),
        },
      ],
    });

    expect(result).toEqual({ written: 2 });
    expect(writeBatch).toHaveBeenCalledTimes(1);
    const rows: readonly GovernanceKpiContribution[] =
      writeBatch.mock.calls[0]![0];
    expect(rows).toHaveLength(2);
  });

  it("writes nothing for a delivery with no governance spans", async () => {
    const writeBatch = vi.fn().mockResolvedValue(undefined);
    const map = createGovernanceKpisMap({
      store: { kind: "append", writeBatch },
    });

    const result = await map.apply({
      tenantId: TENANT_ID,
      events: [
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ tenantId: TENANT_ID, attributes: {} }),
        },
      ],
    });

    expect(result).toEqual({ written: 0 });
    expect(writeBatch).not.toHaveBeenCalled();
  });
});
