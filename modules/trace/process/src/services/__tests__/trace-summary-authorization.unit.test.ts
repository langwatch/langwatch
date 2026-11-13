import { projectIdsReadBy, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it, vi } from "vitest";

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";

/**
 * ADR-177 block F: finding the member that holds a trace costs a light seek. The answer is one
 * tenant id, so it must not pay for the heavy single-trace read.
 */
const AGGREGATE = "project-aggregate";
const ENGINEER = "project-engineer";
const SELLER = "project-seller";

function repositoryHolding(tenantIds: string[]) {
  return {
    upsert: vi.fn(),
    findByTraceId: vi.fn(),
    findTenantIdsByTraceId: vi.fn().mockResolvedValue(tenantIds),
  };
}

const serviceOver = (repository: ReturnType<typeof repositoryHolding>) =>
  TraceSummaryService.create({ repository: repository as never });

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
      const repository = repositoryHolding([SELLER]);

      const narrowed = await serviceOver(repository).getTraceAuthorization({
        authorization: aggregate(),
        traceId: "trace-1",
      });

      expect(narrowed.narrowedTo).toBe(SELLER);
      expect(repository.findByTraceId).not.toHaveBeenCalled();
      expect(repository.findTenantIdsByTraceId).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "trace-1" }),
      );
    });
  });

  describe("when no member holds the trace", () => {
    /** @scenario "A trace no member holds narrows to the reader's own project, never the whole proof" */
    it("narrows to the aggregate's own project, holding no member's grant", async () => {
      const repository = repositoryHolding([]);

      const result = await serviceOver(repository).getTraceAuthorization({
        authorization: aggregate(),
        traceId: "trace-1",
      });

      expect(result.narrowedTo).toBe(AGGREGATE);
      expect(projectIdsReadBy(result)).toEqual([AGGREGATE]);
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });

    /** @scenario "A trace no member holds narrows to the reader's own project, never the whole proof" */
    it("answers trace not found for a proof with no own project", async () => {
      const repository = repositoryHolding([]);
      const membersOnly = aggregate();
      const proof = sealAuthorization({
        ...membersOnly,
        grants: membersOnly.grants.filter((grant) => grant.kind !== "own"),
      });

      await expect(
        serviceOver(repository).getTraceAuthorization({ authorization: proof, traceId: "trace-1" }),
      ).rejects.toMatchObject({ code: "trace_not_found" });
    });
  });

  describe("when the read names the member", () => {
    it("narrows to it without reading at all", async () => {
      const repository = repositoryHolding([SELLER]);

      const narrowed = await serviceOver(repository).getTraceAuthorization({
        authorization: aggregate(),
        traceId: "trace-1",
        tenantId: ENGINEER,
      });

      expect(narrowed.narrowedTo).toBe(ENGINEER);
      expect(repository.findTenantIdsByTraceId).not.toHaveBeenCalled();
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("when the read names a project the proof does not read", () => {
    it("refuses with trace not found", async () => {
      const repository = repositoryHolding([]);

      await expect(
        serviceOver(repository).getTraceAuthorization({
          authorization: aggregate(),
          traceId: "trace-1",
          tenantId: "project-outsider",
        }),
      ).rejects.toMatchObject({ code: "trace_not_found" });
    });
  });
});

describe("given a plain project's proof", () => {
  describe("when a per-trace read names no member", () => {
    it("returns the proof unread", async () => {
      const repository = repositoryHolding([]);
      const authorization = ownProof({ projectId: "project-plain" });

      const result = await serviceOver(repository).getTraceAuthorization({
        authorization,
        traceId: "trace-1",
      });

      expect(result).toBe(authorization);
      expect(repository.findTenantIdsByTraceId).not.toHaveBeenCalled();
      expect(repository.findByTraceId).not.toHaveBeenCalled();
    });
  });
});
