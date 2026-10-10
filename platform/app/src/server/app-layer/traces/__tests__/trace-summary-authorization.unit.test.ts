import { describe, expect, it, vi } from "vitest";
import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";
import { TraceSummaryService } from "../trace-summary.service";

/**
 * ADR-144 block F: finding the member that holds a trace costs a light seek.
 *
 * Every per-trace read under an aggregate that names no member asks the
 * summary service which member holds the trace, including every page of the
 * span tree and every live poll. The answer is one tenant id, so it must not
 * pay for the heavy single-trace read, which projects the computed input,
 * output and attributes only to throw them away.
 */
const AGGREGATE = "project-aggregate";
const ENGINEER = "project-engineer";
const SELLER = "project-seller";

function repositoryHolding(tenantId: string | null) {
  return {
    upsert: vi.fn(),
    findByTraceId: vi.fn(),
    findTenantIdByTraceId: vi.fn().mockResolvedValue(tenantId),
  };
}

const aggregate = () =>
  aggregateProof({
    projectId: AGGREGATE,
    members: [
      { projectId: ENGINEER, from: 0 },
      { projectId: SELLER, from: 0 },
    ],
  });

describe("given an aggregate whose member holds the trace", () => {
  describe("when a per-trace read names no member", () => {
    it("narrows to the member the light seek finds, with no heavy summary read", async () => {
      const repository = repositoryHolding(SELLER);
      const service = new TraceSummaryService(repository as never);

      const narrowed = await service.authorizationForTrace({
        authorization: aggregate(),
        traceId: "trace-1",
      });

      expect(narrowed?.narrowedTo).toBe(SELLER);
      expect(repository.findByTraceId).not.toHaveBeenCalled();
      expect(repository.findTenantIdByTraceId).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-1" }),
      );
    });
  });

  describe("when no member holds the trace", () => {
    it("keeps the proof as it is, for the reads that follow to find nothing", async () => {
      const repository = repositoryHolding(null);
      const service = new TraceSummaryService(repository as never);
      const authorization = aggregate();

      const result = await service.authorizationForTrace({
        authorization,
        traceId: "trace-1",
      });

      expect(result).toBe(authorization);
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("when the read names the member", () => {
    it("narrows to it without reading at all", async () => {
      const repository = repositoryHolding(SELLER);
      const service = new TraceSummaryService(repository as never);

      const narrowed = await service.authorizationForTrace({
        authorization: aggregate(),
        traceId: "trace-1",
        tenantId: ENGINEER,
      });

      expect(narrowed?.narrowedTo).toBe(ENGINEER);
      expect(repository.findTenantIdByTraceId).not.toHaveBeenCalled();
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });
  });
});

describe("given a plain project's proof", () => {
  describe("when a per-trace read names no member", () => {
    it("returns the proof unread", async () => {
      const repository = repositoryHolding(null);
      const service = new TraceSummaryService(repository as never);
      const authorization = ownProof({ projectId: "project-plain" });

      const result = await service.authorizationForTrace({
        authorization,
        traceId: "trace-1",
      });

      expect(result).toBe(authorization);
      expect(repository.findTenantIdByTraceId).not.toHaveBeenCalled();
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });
  });
});
