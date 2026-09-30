import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { InstantEvalPricedSpend } from "../../rules/instant-eval-spend-outcome.rules.ts";
import {
  InstantEvalSpendService,
  type InstantEvalSpendPeers,
} from "../instant-eval-spend.service.ts";

const RECORD = {
  projectId: "project-1",
  inputTokens: 12_000,
  requests: 40,
  costUsd: 0.01,
  priceUsd: 0.013,
  occurredAt: Temporal.Instant.from("2026-09-22T10:00:00.000Z"),
};

function peers(overrides: Partial<InstantEvalSpendPeers> = {}): InstantEvalSpendPeers {
  return {
    findSpendAttribution: async () => ({ organizationId: "org-1", teamId: "team-1" }),
    recordPricedSpend: async () => undefined,
    ...overrides,
  };
}

describe("InstantEvalSpendService", () => {
  /** @scenario "A finished run is one confirmed spend record addressed by the run" */
  /** @scenario "The record is billed against the project's organization and team" */
  it("records one priced outcome, attributed to the project's organization and team", async () => {
    const recorded: InstantEvalPricedSpend[] = [];
    const service = InstantEvalSpendService.create({
      peers: peers({
        recordPricedSpend: async (input) => {
          recorded.push(input);
        },
      }),
    });

    await service.recordSpend({ ...RECORD, runId: "run-1" });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      requestId: "instanteval_run-1",
      organizationId: "org-1",
      teamId: "team-1",
      requestType: INSTANT_EVAL_REQUEST_TYPE,
      model: "jev",
      inputTokens: 12_000,
      costNanoUsd: 13_000_000,
    });
    expect(recorded[0]).not.toHaveProperty("virtualKeyId");
    expect(JSON.parse(recorded[0]?.metadata ?? "{}").instant_eval).toEqual({
      cost_usd: 0.01,
      requests: 40,
      run_id: "run-1",
    });
  });

  /** @scenario "A synchronous query is one confirmed spend record with a fresh id" */
  it("records a query under a fresh id that names no run", async () => {
    const recorded: InstantEvalPricedSpend[] = [];
    const service = InstantEvalSpendService.create({
      peers: peers({
        recordPricedSpend: async (input) => {
          recorded.push(input);
        },
      }),
    });

    await service.recordSpend({ ...RECORD, inputTokens: 500 });
    await service.recordSpend({ ...RECORD, inputTokens: 500 });

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.requestId.startsWith("instantevalquery")).toBe(true);
    expect(recorded[0]?.requestId).not.toBe(recorded[1]?.requestId);
    expect(JSON.parse(recorded[0]?.metadata ?? "{}").instant_eval).not.toHaveProperty("run_id");
  });

  /** @scenario "A retried finish records the same request rather than a second one" */
  it("gives a finish delivered twice the same request id", async () => {
    const requestIds: string[] = [];
    const service = InstantEvalSpendService.create({
      peers: peers({
        recordPricedSpend: async (input) => {
          requestIds.push(input.requestId);
        },
      }),
    });

    await service.recordSpend({ ...RECORD, runId: "run-1" });
    await service.recordSpend({ ...RECORD, runId: "run-1" });

    expect(requestIds).toEqual(["instanteval_run-1", "instanteval_run-1"]);
  });

  it("records nothing for a project with no organization, since the spine would refuse it", async () => {
    const recordPricedSpend = vi.fn(async () => undefined);
    const service = InstantEvalSpendService.create({
      peers: peers({ findSpendAttribution: async () => undefined, recordPricedSpend }),
    });

    await service.recordSpend(RECORD);

    expect(recordPricedSpend).not.toHaveBeenCalled();
  });

  /** @scenario "A record that cannot be dispatched is raised, not dropped" */
  it("raises a dispatch failure, so the finish intent's retry lands on the same request", async () => {
    const service = InstantEvalSpendService.create({
      peers: peers({
        recordPricedSpend: async () => {
          throw new Error("the spend pipeline is not registered");
        },
      }),
    });

    await expect(service.recordSpend(RECORD)).rejects.toThrow(/not registered/);
  });

  it("nudges the organization's month once the spend has landed", async () => {
    const reportBillingMonth = vi.fn(async () => undefined);
    const service = InstantEvalSpendService.create({ peers: peers({ reportBillingMonth }) });

    await service.recordSpend(RECORD);

    expect(reportBillingMonth).toHaveBeenCalledWith({
      organizationId: "org-1",
      occurredAt: RECORD.occurredAt,
    });
  });

  it("keeps the spend when the nudge fails: the report has three other ways to fire", async () => {
    const service = InstantEvalSpendService.create({
      peers: peers({
        reportBillingMonth: async () => {
          throw new Error("billing pipeline unavailable");
        },
      }),
    });

    await expect(service.recordSpend(RECORD)).resolves.toBeUndefined();
  });

  it("bills nothing extra on a deployment with no meter to nudge", async () => {
    const recordPricedSpend = vi.fn(async () => undefined);
    const service = InstantEvalSpendService.create({ peers: peers({ recordPricedSpend }) });

    await service.recordSpend(RECORD);

    expect(recordPricedSpend).toHaveBeenCalledTimes(1);
  });
});
