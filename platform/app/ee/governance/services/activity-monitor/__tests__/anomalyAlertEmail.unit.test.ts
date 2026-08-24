import { describe, expect, it, vi } from "vitest";
import type { AnomalyAlert, AnomalyRule } from "~/generated/prisma/client";
import {
  AnomalyAlertDispatcherService,
  type FetchLike,
  type SendGovernanceAlertEmailLike,
} from "../anomalyAlertDispatcher.service";

const fetchImpl: FetchLike = async () => ({
  status: 200,
  ok: true,
  statusText: "OK",
});

const rule = {
  id: "rule-1",
  organizationId: "org-1",
  name: "Unexpected spend",
  scope: "source",
  scopeId: "source-1",
  destinationConfig: {
    destinations: [
      {
        type: "email",
        to: ["alice@example.com", "bob@example.com"],
      },
    ],
  },
} as unknown as AnomalyRule;

const alert = {
  id: "alert-1",
  triggerWindowStart: new Date("2026-08-24T00:00:00Z"),
  triggerWindowEnd: new Date("2026-08-24T01:00:00Z"),
  detectedAt: new Date("2026-08-24T01:00:01Z"),
  detail: { rawPrompt: "do not email this secret" },
} as unknown as AnomalyAlert;

describe("AnomalyAlertDispatcherService email destination", () => {
  /** @scenario Email destination sends one privacy-safe message per alert */
  it("sends one privacy-safe message to each configured member", async () => {
    const sendEmail = vi.fn<SendGovernanceAlertEmailLike>(
      async (_input) => undefined,
    );
    const dispatcher = AnomalyAlertDispatcherService.create(
      fetchImpl,
      sendEmail,
      async () => ["alice@example.com", "bob@example.com"],
    );

    const result = await dispatcher.dispatchAlert({ rule, alert });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls.map(([input]) => input.to)).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain("rawPrompt");
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(
      "do not email this secret",
    );
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      monitorName: "Activity Monitor",
      ruleName: "Unexpected spend",
      source: "Configured ingestion source",
      windowStartIso: "2026-08-24T00:00:00.000Z",
      windowEndIso: "2026-08-24T01:00:00.000Z",
    });
    expect(result.dispatchTag).toBe("dispatched_email_1");
  });

  /** @scenario Email delivery failure is recorded on the alert */
  it("returns a recipient-safe failed outcome when delivery fails", async () => {
    const dispatcher = AnomalyAlertDispatcherService.create(
      fetchImpl,
      vi.fn(async () => {
        throw new Error("550 alice@example.com rejected");
      }),
      async () => ["alice@example.com", "bob@example.com"],
    );

    const result = await dispatcher.dispatchAlert({ rule, alert });

    expect(result.dispatchTag).toBe("failed_email_1");
    expect(result.outcomes[0]).toEqual({
      destinationIndex: 0,
      type: "email",
      status: "failed",
      reason: "2 of 2 email deliveries failed",
      acceptedCount: 0,
      failedCount: 2,
      totalCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
  });

  it("records accepted and failed counts for partial delivery", async () => {
    const dispatcher = AnomalyAlertDispatcherService.create(
      fetchImpl,
      vi.fn(async ({ to }) => {
        if (to === "bob@example.com") throw new Error("provider rejected");
      }),
      async () => ["alice@example.com", "bob@example.com"],
    );

    const result = await dispatcher.dispatchAlert({ rule, alert });

    expect(result.outcomes[0]).toMatchObject({
      type: "email",
      status: "partial_failure",
      acceptedCount: 1,
      failedCount: 1,
      totalCount: 2,
    });
  });

  it("continues to a webhook when member resolution fails", async () => {
    const mixedRule = {
      ...rule,
      destinationConfig: {
        destinations: [
          { type: "email", to: ["alice@example.com"] },
          { type: "webhook", url: "https://hooks.example.com/alert" },
        ],
      },
    } as unknown as AnomalyRule;
    const fetch = vi.fn<FetchLike>(fetchImpl);
    const dispatcher = AnomalyAlertDispatcherService.create(
      fetch,
      vi.fn(async () => undefined),
      async () => {
        throw new Error("database connection included private details");
      },
    );

    const result = await dispatcher.dispatchAlert({ rule: mixedRule, alert });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual([
      {
        destinationIndex: 0,
        type: "email",
        status: "failed",
        reason: "destination dispatch failed",
        acceptedCount: 0,
        failedCount: 1,
        totalCount: 1,
      },
      { destinationIndex: 1, type: "webhook", status: "succeeded" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private details");
  });
});
