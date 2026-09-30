/**
 * The spend recorder's outcome: one confirmed spend command per query or
 * run, addressed by the run when there is one.
 *
 * @see ../spend-pipeline-instant-eval-spend.recorder.ts
 * @see ../instant-eval-spend.outcome.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  type ConfirmSpendCommandData,
  confirmSpendCommandDataSchema,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import type { InstantEvalSpendRecord } from "../../instant-eval-spend.recorder";
import { INSTANT_EVAL_REQUEST_TYPE } from "../request-type";
import { SpendPipelineInstantEvalSpendRecorder } from "../spend-pipeline-instant-eval-spend.recorder";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const OCCURRED_AT = new Date("2026-09-18T10:00:00.000Z");

const runRecord = (
  overrides: Partial<InstantEvalSpendRecord> = {},
): InstantEvalSpendRecord => ({
  projectId: "proj_1",
  runId: "instanteval_run1",
  inputTokens: 2_000,
  requests: 40,
  costUsd: 0.000084,
  priceUsd: 0.0001092,
  occurredAt: OCCURRED_AT,
  ...overrides,
});

type Dispatch = (data: ConfirmSpendCommandData) => Promise<unknown>;
type ReportBilling = (args: {
  organizationId: string;
  occurredAt: Date;
}) => Promise<void>;

function recorderWith({
  dispatch = vi.fn<Dispatch>(async () => undefined),
  reportBilling,
}: {
  dispatch?: ReturnType<typeof vi.fn<Dispatch>>;
  reportBilling?: ReturnType<typeof vi.fn<ReportBilling>>;
} = {}) {
  const recorder = new SpendPipelineInstantEvalSpendRecorder({
    attribution: async () => ({ organizationId: "org_1", teamId: "team_1" }),
    dispatch,
    ...(reportBilling ? { reportBilling } : {}),
  });
  return { recorder, dispatch };
}

describe("given a finished run", () => {
  describe("when its spend is recorded", () => {
    /** @scenario "A finished run is one confirmed spend record addressed by the run" */
    it("dispatches one confirmed outcome carrying the run's tokens and the customer price", async () => {
      const { recorder, dispatch } = recorderWith();

      await recorder.recordSpend(runRecord());

      expect(dispatch).toHaveBeenCalledTimes(1);
      const outcome = dispatch.mock.calls[0]![0];
      // The spine validates the command on append, so the outcome has to be
      // one its schema accepts, defaults and all.
      expect(confirmSpendCommandDataSchema.safeParse(outcome).success).toBe(
        true,
      );
      expect(outcome).toMatchObject({
        gateway_request_id: "instanteval_instanteval_run1",
        tenantId: "proj_1",
        organization_id: "org_1",
        team_id: "team_1",
        virtual_key_id: "",
        model: "jev",
        model_provider_id: "",
        request_type: INSTANT_EVAL_REQUEST_TYPE,
        occurred_at: OCCURRED_AT.getTime(),
        usage: expect.objectContaining({ input_tokens: 2_000 }),
        cost_nano_usd: 109_200,
        rate_version: "instant_eval@0.042x1.3",
      });
      expect(JSON.parse(outcome.metadata)).toEqual({
        instant_eval: {
          cost_usd: 0.000084,
          requests: 40,
          run_id: "instanteval_run1",
        },
      });
    });

    /** @scenario "A retried finish records the same request rather than a second one" */
    it("addresses a retried finish to the same request", async () => {
      const { recorder, dispatch } = recorderWith();

      await recorder.recordSpend(runRecord());
      await recorder.recordSpend(runRecord());

      const ids = dispatch.mock.calls.map(
        ([outcome]) => outcome.gateway_request_id,
      );
      expect(ids[0]).toBe(ids[1]);
    });

    /** @scenario "The record is billed against the project's organization and team" */
    it("nudges the organization's billing report for the month it landed in", async () => {
      const reportBilling = vi.fn<ReportBilling>(async () => undefined);
      const { recorder } = recorderWith({ reportBilling });

      await recorder.recordSpend(runRecord());

      expect(reportBilling).toHaveBeenCalledWith({
        organizationId: "org_1",
        occurredAt: OCCURRED_AT,
      });
    });

    /** @scenario "A record that cannot be dispatched is raised, not dropped" */
    it("raises a dispatch failure so the finish is delivered again", async () => {
      const { recorder } = recorderWith({
        dispatch: vi.fn<Dispatch>(async () => {
          throw new Error("event store unavailable");
        }),
      });

      await expect(recorder.recordSpend(runRecord())).rejects.toThrow(
        "event store unavailable",
      );
    });

    it("records nothing, and raises nothing, for a project with no organization", async () => {
      const dispatch = vi.fn(async () => undefined);
      const recorder = new SpendPipelineInstantEvalSpendRecorder({
        attribution: async () => null,
        dispatch,
      });

      await recorder.recordSpend(runRecord());

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe("given a synchronous query", () => {
  describe("when its spend is recorded", () => {
    /** @scenario "A synchronous query is one confirmed spend record with a fresh id" */
    it("dispatches one confirmed outcome under a fresh query id that names no run", async () => {
      const { recorder, dispatch } = recorderWith();

      await recorder.recordSpend(runRecord({ runId: undefined }));
      await recorder.recordSpend(runRecord({ runId: undefined }));

      const outcomes = dispatch.mock.calls.map(([outcome]) => outcome);
      expect(outcomes[0]!.gateway_request_id).toMatch(/^instantevalquery_/);
      expect(outcomes[0]!.gateway_request_id).not.toBe(
        outcomes[1]!.gateway_request_id,
      );
      expect(JSON.parse(outcomes[0]!.metadata)).toEqual({
        instant_eval: { cost_usd: 0.000084, requests: 40 },
      });
    });
  });
});
