/**
 * @vitest-environment node
 *
 * End-to-end coverage for the guardrail check the Go data plane calls.
 *
 * Hits real PG via testcontainers. Only the evaluator call itself is injected,
 * because it is the one boundary this service does not own. Everything the
 * service is actually responsible for, project scoping, archive filtering,
 * direction bucketing, failure modes and aggregation, runs against real rows.
 *
 * This endpoint used to be a stub that returned allow for every request while
 * the UI showed guardrails as active, so these tests exist to make an
 * always-allow regression impossible to land quietly.
 *
 * Spec: specs/ai-gateway/guardrail-check-endpoint.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { SingleEvaluationResult } from "../../evaluations/evaluators.generated";
import {
  evaluationDataFor,
  GatewayGuardrailEvaluationService,
  storedDirectionFor,
} from "../guardrailEvaluation.service";

const suffix = nanoid(8);
const ORG_ID = `org-gr-${suffix}`;
const TEAM_ID = `team-gr-${suffix}`;
const PROJECT_ID = `proj-gr-${suffix}`;
const OTHER_PROJECT_ID = `proj-gr-other-${suffix}`;
const USER_ID = `usr-gr-${suffix}`;
const EVALUATOR_ID = `eval-gr-${suffix}`;
const SECOND_EVALUATOR_ID = `eval-gr-2-${suffix}`;

const passing: SingleEvaluationResult = { status: "processed", passed: true };
const failing: SingleEvaluationResult = {
  status: "processed",
  passed: false,
  details: "PII detected: email",
};
const erroring: SingleEvaluationResult = {
  status: "error",
  error_type: "EvaluatorError",
  details: "evaluator exploded",
  traceback: [],
};
const skipped: SingleEvaluationResult = {
  status: "skipped",
  details: "input below the minimum length",
};

const serviceReturning = (result: SingleEvaluationResult) =>
  GatewayGuardrailEvaluationService.create(prisma, async () => result);

async function createGuardrail({
  id,
  projectId,
  evaluatorId,
  direction,
  failureMode,
  archived = false,
}: {
  id: string;
  projectId: string;
  evaluatorId: string;
  direction: "PRE" | "POST" | "STREAM_CHUNK";
  failureMode: "FAIL_OPEN" | "FAIL_CLOSED";
  archived?: boolean;
}) {
  await prisma.gatewayGuardrail.create({
    data: {
      id,
      projectId,
      // Deliberately not the id. policies_triggered must carry the stable id,
      // and a fixture whose name equals its id cannot tell the two apart.
      name: `Display name for ${id}`,
      evaluatorId,
      direction,
      failureMode,
      archivedAt: archived ? new Date() : null,
    },
  });
}

describe("GatewayGuardrailEvaluationService against real PG", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `GR Org ${suffix}`, slug: `gr-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `GR Team ${suffix}`,
        slug: `gr-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    for (const [id, slug] of [
      [PROJECT_ID, `gr-proj-${suffix}`],
      [OTHER_PROJECT_ID, `gr-proj-other-${suffix}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug,
          teamId: TEAM_ID,
          language: "other",
          framework: "other",
          apiKey: `key-${id}`,
        },
      });
    }
    await prisma.user.create({
      data: { id: USER_ID, name: "GR User", email: `gr-${suffix}@acme.test` },
    });

    for (const [evaluatorId, projectId] of [
      [EVALUATOR_ID, PROJECT_ID],
      [SECOND_EVALUATOR_ID, PROJECT_ID],
    ] as const) {
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId,
          name: evaluatorId,
          type: "evaluator",
          config: {},
        },
      });
      await prisma.monitor.create({
        data: {
          id: `mon-${evaluatorId}`,
          projectId,
          evaluatorId,
          checkType: "langevals/basic",
          name: `mon-${evaluatorId}`,
          slug: `mon-${evaluatorId}`,
          executionMode: "AS_GUARDRAIL",
          enabled: true,
          preconditions: [],
          // Distinct parameters per evaluator so a test can route a verdict
          // to one guardrail and not the other within a single check.
          parameters:
            evaluatorId === SECOND_EVALUATOR_ID
              ? { verdict: "fail" }
              : { verdict: "pass" },
        },
      });
    }
  }, 180_000);

  afterAll(async () => {
    await stopTestContainers();
  });

  describe("given a guardrail whose evaluator fails the content", () => {
    /** @scenario "an evaluator that fails the content blocks the request" */
    it("blocks the request and names the policy", async () => {
      const id = `gr-block-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(failing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
        content: { messages: [{ role: "user", content: "my email is a@b.c" }] },
      });

      expect(verdict.decision).toBe("block");
      expect(verdict.reason).toBe("PII detected: email");
      expect(verdict.policies_triggered).toEqual([id]);
    });
  });

  describe("given a guardrail whose evaluator passes", () => {
    /** @scenario "an evaluator that passes allows the request" */
    it("allows the request", async () => {
      const id = `gr-allow-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(passing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
        content: { messages: [] },
      });

      expect(verdict.decision).toBe("allow");
      expect(verdict.policies_triggered).toEqual([]);
    });
  });

  describe("given the evaluator skipped the content", () => {
    /** @scenario "a skipped evaluator does not block" */
    it("allows the request rather than treating the skip as a failure", async () => {
      const id = `gr-skipped-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        // Fail-closed, so a skip that fell through to the failure path would
        // block. It must not: a skip is the evaluator declining to judge, not
        // an evaluator that could not run.
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(skipped).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
        content: { messages: [{ role: "user", content: "hi" }] },
      });

      expect(verdict.decision).toBe("allow");
      expect(verdict.policies_triggered).toEqual([]);
    });
  });

  describe("given the evaluator errors", () => {
    /** @scenario "a fail-closed guardrail blocks when its evaluator errors" */
    it("blocks when the guardrail is fail-closed", async () => {
      const id = `gr-failclosed-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(erroring).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("block");
      expect(verdict.reason).toContain("evaluator exploded");
    });

    /** @scenario "a fail-open guardrail allows when its evaluator errors" */
    it("allows when the guardrail is fail-open", async () => {
      const id = `gr-failopen-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_OPEN",
      });

      const verdict = await serviceReturning(erroring).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("allow");
    });
  });

  describe("given several guardrails in one direction", () => {
    /** @scenario "any blocking guardrail blocks the whole check" */
    it("blocks when any of them blocks, naming only the one that failed", async () => {
      const passId = `gr-multi-pass-${suffix}`;
      const failId = `gr-multi-fail-${suffix}`;
      await createGuardrail({
        id: passId,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });
      await createGuardrail({
        id: failId,
        projectId: PROJECT_ID,
        evaluatorId: SECOND_EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const allAllowed = await serviceReturning(passing).check({
        projectId: PROJECT_ID,
        guardrailIds: [passId, failId],
        direction: "request",
      });
      expect(allAllowed.decision).toBe("allow");

      // Both guardrails are in the request and only one fails. The runner
      // routes on the monitor parameters, which differ per evaluator, so the
      // two guardrails genuinely behave differently in a single check.
      const routed = GatewayGuardrailEvaluationService.create(
        prisma,
        async ({ settings }) =>
          (settings as { verdict?: string })?.verdict === "fail"
            ? failing
            : passing,
      );
      const blocked = await routed.check({
        projectId: PROJECT_ID,
        guardrailIds: [passId, failId],
        direction: "request",
      });

      expect(blocked.decision).toBe("block");
      // The id, not the display name, and only the guardrail that failed.
      expect(blocked.policies_triggered).toEqual([failId]);
    });
  });

  describe("given a guardrail that must not be evaluated", () => {
    /** @scenario "guardrails from another project are never evaluated" */
    it("ignores one from another project", async () => {
      const id = `gr-other-proj-${suffix}`;
      await prisma.evaluator.create({
        data: {
          id: `eval-other-${suffix}`,
          projectId: OTHER_PROJECT_ID,
          name: "other",
          type: "evaluator",
          config: {},
        },
      });
      await createGuardrail({
        id,
        projectId: OTHER_PROJECT_ID,
        evaluatorId: `eval-other-${suffix}`,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(failing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("allow");
    });

    /** @scenario "an archived guardrail is not evaluated" */
    it("ignores an archived one", async () => {
      const id = `gr-archived-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
        archived: true,
      });

      const verdict = await serviceReturning(failing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("allow");
    });

    it("ignores one bound to another direction", async () => {
      const id = `gr-wrong-direction-${suffix}`;
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        direction: "POST",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(failing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("allow");
    });
  });

  describe("given the evaluator lost its guardrail monitor", () => {
    it("treats it as a failure rather than a pass", async () => {
      const evaluatorId = `eval-nomonitor-${suffix}`;
      const id = `gr-nomonitor-${suffix}`;
      await prisma.evaluator.create({
        data: {
          id: evaluatorId,
          projectId: PROJECT_ID,
          name: evaluatorId,
          type: "evaluator",
          config: {},
        },
      });
      await createGuardrail({
        id,
        projectId: PROJECT_ID,
        evaluatorId,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
      });

      const verdict = await serviceReturning(passing).check({
        projectId: PROJECT_ID,
        guardrailIds: [id],
        direction: "request",
      });

      expect(verdict.decision).toBe("block");
    });
  });

  describe("when no guardrails are attached", () => {
    it("allows without touching the database", async () => {
      const verdict = await serviceReturning(failing).check({
        projectId: PROJECT_ID,
        guardrailIds: [],
        direction: "request",
      });
      expect(verdict.decision).toBe("allow");
    });
  });
});

describe("wire direction mapping", () => {
  it("maps each wire direction onto its stored enum", () => {
    expect(storedDirectionFor("request")).toBe("PRE");
    expect(storedDirectionFor("response")).toBe("POST");
    expect(storedDirectionFor("stream_chunk")).toBe("STREAM_CHUNK");
  });
});

describe("evaluation input", () => {
  it("scores the prompt on the request direction", () => {
    const data = evaluationDataFor({
      direction: "request",
      content: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(data.input).toContain("hi");
    expect(data.output).toBe("");
  });

  it("scores the completion on the response direction", () => {
    const data = evaluationDataFor({
      direction: "response",
      content: { output: "the answer" },
    });
    expect(data.output).toBe("the answer");
    expect(data.input).toBe("");
  });

  it("scores the chunk on the stream direction", () => {
    const data = evaluationDataFor({
      direction: "stream_chunk",
      content: { chunk: "partial" },
    });
    expect(data.output).toBe("partial");
  });
});
