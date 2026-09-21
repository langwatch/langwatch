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
  occurredAt: new Date("2026-09-22T10:00:00.000Z"),
};

function peers(overrides: Partial<InstantEvalSpendPeers> = {}): InstantEvalSpendPeers {
  return {
    findSpendAttribution: async () => ({ organizationId: "org-1", teamId: "team-1" }),
    recordPricedSpend: async () => undefined,
    ...overrides,
  };
}

describe("InstantEvalSpendService", () => {
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
      costNanoUsd: 13_000_000,
    });
  });

  it("records nothing for a project with no organization, since the spine would refuse it", async () => {
    const recordPricedSpend = vi.fn(async () => undefined);
    const service = InstantEvalSpendService.create({
      peers: peers({ findSpendAttribution: async () => undefined, recordPricedSpend }),
    });

    await service.recordSpend(RECORD);

    expect(recordPricedSpend).not.toHaveBeenCalled();
  });

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
