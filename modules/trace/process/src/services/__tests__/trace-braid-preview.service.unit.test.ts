/**
 * The braid dialog's behaviour over its reads (ADR-183 §7): refusals, the trace cap, which proof
 * each read takes, the pair's live braids beside the draft, and each braid's 24-hour window.
 * Spec: modules/trace/specs/braided-spans.feature, modules/authz/specs/braids-screen.feature
 */
import { ownProjectIdReadBy, type CompiledWhere } from "@langwatch/authorization";
import type { AuthzBraid } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { braidedProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import {
  EmptyTraceBraidReadsRepository,
  type TraceBraidReadsRepository,
} from "../../repositories/trace-braid-reads.repository.ts";
import {
  BRAID_PREVIEW_TRACE_CAP,
  type BraidReaderSpans,
  TraceBraidPreviewService,
} from "../trace-braid-preview.service.ts";

const OWNER = "proj_specialists";
const READER = "proj_orchestrator";
const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

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

/** An owner span as the marked read returns it, before its braided flag. */
function ownerSpan(spanId: string, startTimeMs: number) {
  return {
    spanId,
    parentSpanId: null,
    name: spanId,
    type: null,
    startTimeMs,
    endTimeMs: startTimeMs + 1,
    durationMs: 1,
    status: "ok" as const,
    model: null,
    cost: null,
    costInput: { attrs: {}, promptTokens: null, completionTokens: null },
  };
}

function serviceOver({
  traceIds = [] as string[],
  braids = [] as AuthzBraid[],
  exampleTraceId = null as string | null,
} = {}) {
  const reads: TraceBraidReadsRepository = EmptyTraceBraidReadsRepository.create();
  const spies = {
    findReaderTraceIds: vi.spyOn(reads, "findReaderTraceIds").mockResolvedValue(traceIds),
    countOwnerSpansInTraces: vi.spyOn(reads, "countOwnerSpansInTraces").mockResolvedValue({
      shown: { every: 2, some: 1, spans: 9 },
      live: { every: 1, some: 1, spans: 5 },
      unsigned: 3,
      exampleTraceId,
    }),
    findOwnerSpansMarked: vi.spyOn(reads, "findOwnerSpansMarked").mockResolvedValue([]),
    countOwnerBraidActivity: vi
      .spyOn(reads, "countOwnerBraidActivity")
      .mockResolvedValue(new Map([["braid_out", 4]])),
    countReaderBraidActivity: vi
      .spyOn(reads, "countReaderBraidActivity")
      .mockResolvedValue(new Map([["braid_in", 6]])),
  };
  const readerSpans = vi.fn<BraidReaderSpans>(async ({ traceId }) => [
    {
      spanId: `root-${traceId}`,
      parentSpanId: null,
      name: "handle_message",
      type: null,
      startTimeMs: 1,
      endTimeMs: 2,
      durationMs: 1,
      status: "ok",
      model: null,
    },
  ]);
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
      expect(spanRead).toMatchObject({ traceIds: ["t1"], live: [] });
      expect(spanRead.draft).toMatchObject({ readerProjectId: READER, fromMs: 5, untilMs: null });
      expect(preview.unsignedHidden).toBe(3);
    });
  });

  describe("when the reader already sees spans from the owner through live braids", () => {
    const readerWithBraids = braidedProof({
      projectId: READER,
      braids: [
        { owner: OWNER, compiledWhere: WEB, from: 100, until: 900 },
        { owner: OWNER, from: 300 },
        { owner: "proj_elsewhere", compiledWhere: WEB },
      ],
    });

    /** @scenario A further braid on the same pair says what it adds */
    it("counts the owner's live braids and the draft in one read, each braid in its own window", async () => {
      const { service, reads } = serviceOver({ traceIds: ["t1", "t2"] });

      const preview = await service.preview({
        ownerAuthorization: proofs.ownerAuthorization,
        readerAuthorization: readerWithBraids,
        where: 'attributes["team"] == "billing"',
        fromMs: 500,
      });

      expect(reads.countOwnerSpansInTraces).toHaveBeenCalledTimes(1);
      const spanRead = reads.countOwnerSpansInTraces.mock.calls[0]?.[0];
      expect(spanRead?.live).toEqual([
        { compiledWhere: WEB, readerProjectId: READER, fromMs: 100, untilMs: 900 },
        { compiledWhere: undefined, readerProjectId: READER, fromMs: 300, untilMs: null },
      ]);
      expect(spanRead?.draft).toMatchObject({ fromMs: 500, untilMs: null });
      expect(preview).toMatchObject({
        traces: { every: 2, some: 1, none: 0, total: 2 },
        spans: 9,
        live: { braids: 2, traces: { every: 1, some: 1, none: 0, total: 2 }, spans: 5 },
      });
    });

    describe("and one of them is the braid being edited", () => {
      /** @scenario A further braid on the same pair says what it adds */
      it("lets the draft replace that braid rather than count beside it", async () => {
        const { service, reads } = serviceOver({ traceIds: ["t1"] });

        const preview = await service.preview({
          ownerAuthorization: proofs.ownerAuthorization,
          readerAuthorization: readerWithBraids,
          where: "",
          fromMs: 0,
          braidId: "braid_0",
        });

        const spanRead = reads.countOwnerSpansInTraces.mock.calls[0]?.[0];
        expect(spanRead?.live).toEqual([expect.objectContaining({ fromMs: 300 })]);
        expect(preview.live.braids).toBe(1);
      });
    });
  });

  describe("when ana tests a trace on a pair that already has live braids", () => {
    const readerWithBraids = braidedProof({
      projectId: READER,
      braids: [
        { owner: OWNER, compiledWhere: WEB, from: 100, until: 900 },
        { owner: OWNER, from: 300 },
      ],
    });

    /** @scenario Testing a trace shows it exactly as the reader will see it */
    it("marks the owner's spans by the live braids and the draft, as the count reads them", async () => {
      const { service, reads } = serviceOver();
      reads.findOwnerSpansMarked.mockResolvedValue([{ ...ownerSpan("o-1", 3), braided: true }]);

      const tested = await service.testTrace({
        ownerAuthorization: proofs.ownerAuthorization,
        readerAuthorization: readerWithBraids,
        where: 'attributes["team"] == "billing"',
        fromMs: 500,
        traceId: "t1",
      });

      const marked = reads.findOwnerSpansMarked.mock.calls[0]?.[0];
      expect(ownProjectIdReadBy(marked?.authorization ?? proofs.readerAuthorization)).toBe(OWNER);
      expect(marked?.braids).toEqual([
        { compiledWhere: WEB, readerProjectId: READER, fromMs: 100, untilMs: 900 },
        { compiledWhere: undefined, readerProjectId: READER, fromMs: 300, untilMs: null },
        expect.objectContaining({ readerProjectId: READER, fromMs: 500, untilMs: null }),
      ]);
      expect(tested.nodes).toContainEqual(
        expect.objectContaining({ spanId: "o-1", ownerProjectId: OWNER, braided: true }),
      );
    });

    it("reads the draft in place of the braid being edited", async () => {
      const { service, reads } = serviceOver();

      await service.testTrace({
        ownerAuthorization: proofs.ownerAuthorization,
        readerAuthorization: readerWithBraids,
        where: "",
        fromMs: 500,
        traceId: "t1",
        braidId: "braid_0",
      });

      expect(reads.findOwnerSpansMarked.mock.calls[0]?.[0].braids.map((b) => b.fromMs)).toEqual([
        300, 500,
      ]);
    });
  });

  describe("when a counted trace gets a braided span", () => {
    /** @scenario The preview counts what the reader will see as the condition changes */
    it("reads the example the count named, the owner's spans marked by the live braids and the draft", async () => {
      const { service, reads, readerSpans } = serviceOver({
        traceIds: ["t1", "t2"],
        exampleTraceId: "t2",
      });
      reads.findOwnerSpansMarked.mockResolvedValue([
        { ...ownerSpan("o-1", 3), braided: true },
        { ...ownerSpan("o-2", 2), braided: false },
      ]);

      const preview = await service.preview({
        ownerAuthorization: proofs.ownerAuthorization,
        readerAuthorization: braidedProof({
          projectId: READER,
          braids: [{ owner: OWNER, compiledWhere: WEB }],
        }),
        where: "",
        fromMs: 7,
      });

      expect(readerSpans.mock.calls[0]?.[0].traceId).toBe("t2");
      const marked = reads.findOwnerSpansMarked.mock.calls[0]?.[0];
      expect(ownProjectIdReadBy(marked?.authorization ?? proofs.readerAuthorization)).toBe(OWNER);
      expect(marked?.braids.map((braid) => braid.fromMs)).toEqual([0, 7]);
      expect(preview.example).toEqual({
        traceId: "t2",
        nodes: [
          expect.objectContaining({ spanId: "root-t2" }),
          expect.objectContaining({ spanId: "o-2", ownerProjectId: OWNER, braided: false }),
          expect.objectContaining({ spanId: "o-1", ownerProjectId: OWNER, braided: true }),
        ],
      });
    });

    it("shows no example when no counted trace gets one", async () => {
      const { service, reads, readerSpans } = serviceOver({ traceIds: ["t1"] });

      const preview = await service.preview({ ...proofs, where: "", fromMs: 0 });

      expect(preview.example).toBeNull();
      expect(readerSpans).not.toHaveBeenCalled();
      expect(reads.findOwnerSpansMarked).not.toHaveBeenCalled();
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
