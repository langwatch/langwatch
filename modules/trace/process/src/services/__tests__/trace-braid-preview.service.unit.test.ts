/**
 * The braid dialog's behaviour over its reads (ADR-183 §7): refusals, the trace cap, which proof
 * each read takes, and each braid's 24-hour window. Spec: modules/trace/specs/braided-spans.feature
 */
import { ownProjectIdReadBy } from "@langwatch/authorization";
import type { AuthzBraid } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { braidedProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import {
  EmptyTraceBraidReadsRepository,
  type TraceBraidReadsRepository,
} from "../../repositories/trace-braid-reads.repository.ts";
import {
  BRAID_PREVIEW_TRACE_CAP,
  TraceBraidPreviewService,
} from "../trace-braid-preview.service.ts";

const OWNER = "proj_specialists";
const READER = "proj_orchestrator";
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function braidOf(overrides: Partial<AuthzBraid>): AuthzBraid {
  return {
    braidId: "braid_web",
    ownerProjectId: OWNER,
    readerProjectId: READER,
    where: 'attributes["orchestrator"] == "web"',
    fromMs: 0,
    expiresAtMs: null,
    createdByUserId: null,
    createdAtMs: 0,
    ...overrides,
  };
}

function serviceOver({ traceIds = [] as string[], braids = [] as AuthzBraid[] } = {}) {
  const reads: TraceBraidReadsRepository = EmptyTraceBraidReadsRepository.create();
  const spies = {
    findReaderTraceIds: vi.spyOn(reads, "findReaderTraceIds").mockResolvedValue(traceIds),
    countOwnerSpansInTraces: vi
      .spyOn(reads, "countOwnerSpansInTraces")
      .mockResolvedValue({ every: 2, some: 1, unsigned: 3 }),
    countOwnerBraidActivity: vi
      .spyOn(reads, "countOwnerBraidActivity")
      .mockResolvedValue(new Map([["braid_out", 4]])),
    countReaderBraidActivity: vi
      .spyOn(reads, "countReaderBraidActivity")
      .mockResolvedValue(new Map([["braid_in", 6]])),
  };
  const readerSpans = vi.fn(async () => []);
  const service = TraceBraidPreviewService.create({
    reads,
    readerSpans,
    braids: {
      listBraids: async () => ({
        intoOtherProjects: braids.filter((braid) => braid.ownerProjectId === OWNER),
        fromOtherProjects: braids.filter((braid) => braid.readerProjectId === OWNER),
      }),
    },
    now: () => NOW,
  });
  return { service, reads: spies, readerSpans };
}

const proofs = {
  ownerAuthorization: ownProof({ projectId: OWNER }),
  readerAuthorization: ownProof({ projectId: READER }),
};

describe("TraceBraidPreviewService", () => {
  describe("when the condition is refused", () => {
    /** @scenario "The preview shows why a condition is refused" */
    it("answers the refusal with its message and reads nothing", async () => {
      const { service, reads } = serviceOver();

      const preview = await service.preview({ ...proofs, where: "name or x", fromMs: 0 });

      expect(preview.refusal).toMatchObject({
        construct: expect.any(String),
        at: expect.any(Number),
      });
      expect(preview.refusal?.message).toContain(preview.refusal?.construct);
      expect(preview.unsignedHidden).toBeNull();
      expect(reads.findReaderTraceIds).not.toHaveBeenCalled();
    });

    it("refuses a test trace with the compiler's refusal code", async () => {
      const { service, readerSpans } = serviceOver();

      await expect(
        service.testTrace({ ...proofs, where: "name or x", fromMs: 0, traceId: "trace-1" }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^braid_condition_/) });
      expect(readerSpans).not.toHaveBeenCalled();
    });
  });

  describe("when the reader holds more recent traces than the cap", () => {
    /** @scenario "The preview says when it counted only the newest traces" */
    it("counts the newest up to the cap and says it was capped", async () => {
      const traceIds = Array.from({ length: BRAID_PREVIEW_TRACE_CAP + 1 }, (_, i) => `t${i}`);
      const { service, reads } = serviceOver({ traceIds });

      const preview = await service.preview({ ...proofs, where: "", fromMs: 0 });

      expect(preview.traces).toEqual({
        every: 2,
        some: 1,
        none: BRAID_PREVIEW_TRACE_CAP - 3,
        total: BRAID_PREVIEW_TRACE_CAP,
        capped: true,
      });
      expect(reads.findReaderTraceIds).toHaveBeenCalledWith(
        expect.objectContaining({ limit: BRAID_PREVIEW_TRACE_CAP + 1, sinceMs: NOW - 7 * DAY_MS }),
      );
    });
  });

  describe("when the preview reads both projects", () => {
    it("reads trace ids with the reader's proof and the owner's spans with the owner's", async () => {
      const { service, reads } = serviceOver({ traceIds: ["t1"] });

      const preview = await service.preview({ ...proofs, where: 'Verified("sig")', fromMs: 5 });

      const idRead = reads.findReaderTraceIds.mock.calls[0]?.[0];
      const spanRead = reads.countOwnerSpansInTraces.mock.calls[0]?.[0];
      if (idRead === undefined || spanRead === undefined) throw new Error("a read was skipped");
      expect(ownProjectIdReadBy(idRead.authorization)).toBe(READER);
      expect(ownProjectIdReadBy(spanRead.authorization)).toBe(OWNER);
      expect(spanRead).toMatchObject({ traceIds: ["t1"], fromMs: 5 });
      expect(spanRead.condition.readerProjectId).toBe(READER);
      expect(preview.unsignedHidden).toBe(3);
    });
  });

  describe("when a Braids page asks for its braids' activity", () => {
    it("counts braids out of the project as owner and into it as reader, each in its 24-hour window", async () => {
      const { service, reads } = serviceOver({
        braids: [
          braidOf({ braidId: "braid_out", expiresAtMs: NOW - 1000 }),
          braidOf({ braidId: "braid_in", ownerProjectId: "proj_x", readerProjectId: OWNER }),
        ],
      });

      const { activity } = await service.activity({
        projectId: OWNER,
        authorization: braidedProof({ projectId: OWNER, braids: [{ owner: "proj_x" }] }),
        braidIds: ["braid_out", "braid_in", "braid_unknown"],
      });

      expect(activity).toEqual([
        { braidId: "braid_out", spanCount: 4 },
        { braidId: "braid_in", spanCount: 6 },
      ]);
      const asOwner = reads.countOwnerBraidActivity.mock.calls[0]?.[0];
      expect(asOwner?.braids).toEqual([
        expect.objectContaining({
          braidId: "braid_out",
          fromMs: NOW - DAY_MS,
          untilMs: NOW - 1000,
        }),
      ]);
    });
  });
});
