import { beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceFixture } from "../../__tests__/evidence-fixture";
import type { Claim } from "../../report.types";
import { runVerifierPass } from "../verifier-pass";

/**
 * The pass that decides `verified` against `unchecked`, which is the tier the
 * whole document is badged with.
 *
 * `generateObject` is the one boundary mocked here: everything this file is
 * about happens on either side of it. What goes IN is the check being real at
 * all (the citations and the evidence they point at), and what comes OUT is
 * the coverage gate and the id handling that stop a malformed reply from
 * emptying a report that was fine.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const generateObject = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateObject }));

const resolveModel = vi.fn(async () => "fake-model" as never);

function claimsOf(count: number): Claim[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `past.outcome#${index}`,
    text: `Statement number ${index}.`,
    citations: [{ kind: "run" as const, runId: "run_1" }],
  }));
}

function respondWith(verdicts: { claimId: string; supported: boolean }[]) {
  generateObject.mockResolvedValue({ object: { verdicts } });
}

function promptSent(): string {
  return generateObject.mock.calls[0]?.[0]?.prompt as string;
}

describe("runVerifierPass()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given claims to check", () => {
    /** @scenario The second reading is shown the evidence each statement points at */
    it("shows the checker each claim's citations and what they point at", async () => {
      respondWith([{ claimId: "past.outcome#0", supported: true }]);

      await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: [
          {
            id: "past.outcome#0",
            // The run id is gone from the sentence by the time it arrives
            // here, which is exactly why the citation has to carry it.
            text: "Refund escalation revealed the discount ceiling.",
            citations: [
              { kind: "run", runId: "run_1" },
              { kind: "criterion", criterionId: "c_known" },
            ],
          },
        ],
        resolveModel,
      });

      const prompt = promptSent();
      expect(prompt).toContain("cites run:run_1");
      expect(prompt).toContain("cites criterion:c_known");
      // Not the key alone: the line the key resolves to, which is the only
      // thing that turns "sounds plausible" into "the evidence says this".
      expect(prompt).toContain("Refund escalation");
      expect(prompt).toContain("stays polite");
    });

    /** @scenario A statement pointing at nothing is marked as such for the check */
    it("marks a citation the evidence cannot resolve rather than dropping it", async () => {
      respondWith([{ claimId: "past.outcome#0", supported: false }]);

      await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: [
          {
            id: "past.outcome#0",
            text: "A run nobody has.",
            citations: [{ kind: "run", runId: "run_absent" }],
          },
        ],
        resolveModel,
      });

      expect(promptSent()).toContain("no such item in the evidence");
    });

    it("names the evidence as untrusted data with explicit bounds", async () => {
      respondWith([{ claimId: "past.outcome#0", supported: true }]);

      await runVerifierPass({
        evidenceBlock: "## RUN\nsuite_name: anything",
        evidence: evidenceFixture(),
        claims: claimsOf(1),
        resolveModel,
      });

      const prompt = promptSent();
      expect(prompt).toContain("BEGIN UNTRUSTED DATA");
      expect(prompt).toContain("END UNTRUSTED DATA");
    });
  });

  describe("given a response that ruled on enough of the claims", () => {
    it("keeps only the ones it affirmatively supported", async () => {
      respondWith([
        { claimId: "past.outcome#0", supported: true },
        { claimId: "past.outcome#1", supported: false },
      ]);

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(2),
        resolveModel,
      });

      expect(outcome?.isUsable).toBe(true);
      expect([...(outcome?.supported ?? [])]).toEqual(["past.outcome#0"]);
    });

    it("takes the first ruling when a claim id is repeated", async () => {
      respondWith([
        { claimId: "past.outcome#0", supported: false },
        { claimId: "past.outcome#0", supported: true },
        { claimId: "past.outcome#1", supported: true },
      ]);

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(2),
        resolveModel,
      });

      expect(outcome?.supported.has("past.outcome#0")).toBe(false);
      expect(outcome?.isUsable).toBe(true);
    });

    it("ignores a verdict on an id it was never given", async () => {
      respondWith([
        { claimId: "past.outcome#0", supported: true },
        { claimId: "invented#9", supported: true },
        { claimId: "past.outcome#1", supported: true },
      ]);

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(2),
        resolveModel,
      });

      expect([...(outcome?.supported ?? [])].sort()).toEqual([
        "past.outcome#0",
        "past.outcome#1",
      ]);
    });
  });

  describe("given a response that skipped most of the claims", () => {
    it("reports the pass as unusable at the coverage boundary", async () => {
      // Four claims, one ruled on: below the half the gate demands.
      respondWith([{ claimId: "past.outcome#0", supported: true }]);

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(4),
        resolveModel,
      });

      expect(outcome?.isUsable).toBe(false);
    });

    it("treats exactly half the claims as enough to act on", async () => {
      respondWith([
        { claimId: "past.outcome#0", supported: true },
        { claimId: "past.outcome#1", supported: true },
      ]);

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(4),
        resolveModel,
      });

      expect(outcome?.isUsable).toBe(true);
    });
  });

  describe("given no claims at all", () => {
    it("calls no model and reports a usable, empty result", async () => {
      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: [],
        resolveModel,
      });

      expect(generateObject).not.toHaveBeenCalled();
      expect(outcome).toEqual({ supported: new Set(), isUsable: true });
    });
  });

  describe("given the call fails", () => {
    it("returns null so the report ships unchecked rather than empty", async () => {
      generateObject.mockRejectedValue(new Error("provider exploded"));

      const outcome = await runVerifierPass({
        evidenceBlock: "## RUN",
        evidence: evidenceFixture(),
        claims: claimsOf(2),
        resolveModel,
      });

      expect(outcome).toBeNull();
    });

    it("rethrows an abort, because a cancelled export must stop", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      generateObject.mockRejectedValue(abort);

      await expect(
        runVerifierPass({
          evidenceBlock: "## RUN",
          evidence: evidenceFixture(),
          claims: claimsOf(2),
          resolveModel,
        }),
      ).rejects.toThrow("aborted");
    });
  });
});
