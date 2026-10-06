/**
 * @vitest-environment node
 * Trace's fold of governance's coding-assistant billing fact and the receiver policy built from it.
 * Spec: specs/server/otlp-receiver-policy.feature
 */
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceIngestSourceBillingRepository } from "../../repositories/memory/memory.trace-ingest-source-billing.repository.ts";
import type { TraceIngestSourceBillingRepository } from "../../repositories/trace-ingest-source-billing.repository.ts";
import { TraceIngestSourceBillingService } from "../trace-ingest-source-billing.service.ts";

const ORG = "organization-1";
const NON_BILLABLE = "langwatch.cost.non_billable";

function service(
  repository: TraceIngestSourceBillingRepository = MemoryTraceIngestSourceBillingRepository.create(),
) {
  let now = 1_000;
  const billing = TraceIngestSourceBillingService.create({
    repository,
    logger: { warn: vi.fn() },
    now: () => now,
  });
  return { billing, repository, advance: (ms: number) => (now += ms) };
}

function markerOf(attributes: readonly { key: string; value: unknown }[] | undefined) {
  return attributes?.find((attribute) => attribute.key === NON_BILLABLE)?.value;
}

describe("TraceIngestSourceBillingService", () => {
  describe("given governance recorded billing facts for an organization's source", () => {
    /** @scenario "Trace folds the billing fact and an absent row is non-billable" */
    it("keeps the latest fact per source and ignores an older one delivered late", async () => {
      const { billing, repository } = service();

      await billing.fold({
        organizationId: ORG,
        sourceType: "claude_code",
        billed: true,
        recordedAtMs: 200,
      });
      await billing.fold({
        organizationId: ORG,
        sourceType: "claude_code",
        billed: false,
        recordedAtMs: 100,
      });

      await expect(
        repository.find({ organizationId: ORG, sourceType: "claude_code" }),
      ).resolves.toEqual({
        billed: true,
        recordedAtMs: 200,
      });

      await billing.fold({
        organizationId: ORG,
        sourceType: "claude_code",
        billed: false,
        recordedAtMs: 300,
      });
      await expect(
        repository.find({ organizationId: ORG, sourceType: "claude_code" }),
      ).resolves.toEqual({
        billed: false,
        recordedAtMs: 300,
      });
    });

    it("stamps the marker false on traces and logs while the source is billed", async () => {
      const { billing } = service();
      await billing.fold({
        organizationId: ORG,
        sourceType: "claude_code",
        billed: true,
        recordedAtMs: 200,
      });

      const policies = await billing.receiverPolicies({
        organizationId: ORG,
        sourceType: "claude_code",
      });

      expect(markerOf(policies.traces.resourceAttributes)).toEqual({ stringValue: "false" });
      expect(markerOf(policies.logs.resourceAttributes)).toEqual({ stringValue: "false" });
    });
  });

  describe("given a source with no folded row", () => {
    it("builds the non-billable policy on traces and logs but not on metrics", async () => {
      const { billing } = service();

      const policies = await billing.receiverPolicies({
        organizationId: ORG,
        sourceType: "copilot_vscode",
        templateId: "template-1",
      });

      expect(markerOf(policies.traces.resourceAttributes)).toEqual({ stringValue: "true" });
      expect(markerOf(policies.logs.resourceAttributes)).toEqual({ stringValue: "true" });
      expect(markerOf(policies.metrics.resourceAttributes)).toBeUndefined();
      expect(policies.traces.allowedTraceScopeNames).toEqual(["github.copilot", "@github/copilot"]);
    });
  });

  describe("given the row cannot be read", () => {
    it("answers not billed rather than refusing, and asks again on the next call", async () => {
      const find = vi.fn().mockRejectedValue(new Error("connection reset"));
      const { billing } = service({ find, recordIfNewer: vi.fn() } as never);

      await expect(billing.isBilled({ organizationId: ORG, sourceType: "codex" })).resolves.toBe(
        false,
      );
      await expect(billing.isBilled({ organizationId: ORG, sourceType: "codex" })).resolves.toBe(
        false,
      );
      expect(find).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a billed answer was read", () => {
    it("reuses it for thirty seconds, then reads the row again", async () => {
      const repository = MemoryTraceIngestSourceBillingRepository.create();
      const find = vi.spyOn(repository, "find");
      const { billing, advance } = service(repository);
      await billing.fold({
        organizationId: ORG,
        sourceType: "codex",
        billed: true,
        recordedAtMs: 10,
      });

      await billing.isBilled({ organizationId: ORG, sourceType: "codex" });
      advance(29_999);
      await billing.isBilled({ organizationId: ORG, sourceType: "codex" });
      expect(find).toHaveBeenCalledTimes(1);

      advance(1);
      await billing.isBilled({ organizationId: ORG, sourceType: "codex" });
      expect(find).toHaveBeenCalledTimes(2);
    });
  });
});
