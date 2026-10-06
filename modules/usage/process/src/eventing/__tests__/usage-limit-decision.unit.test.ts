import { createTenantId } from "@langwatch/eventing";
import {
  type MonthCountedEventData,
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
} from "@langwatch/usage-contract";
import { describe, expect, it } from "vitest";

import type { LimitState } from "../../rules/usage-limit.rules.ts";
import { monthCounted, refusedOrganizationWake } from "../refused-organizations.process.ts";
import { RecordLimitDecisionCommand } from "../usage.commands.ts";
import {
  type RecordLimitDecisionCommandData,
  recordLimitDecisionCommandDataSchema,
} from "../usage.events.ts";

const NOW = Date.UTC(2026, 9, 15);

const ctx = {
  at: NOW,
  now: NOW,
  key: "org_1",
  projectId: "org_1",
  // The runtime stores intents as JSON, so the payload is round-tripped as it would be.
  intent: (name: string, key: string, payload: unknown) => ({
    messageKey: key,
    intentType: name,
    payload: JSON.parse(JSON.stringify(payload)),
  }),
};

const counted = (billableEvents: number, allowance: number): MonthCountedEventData => ({
  organizationId: "org_1",
  month: "2026-10",
  occurredAt: NOW,
  billableEvents,
  limit: { allowance, planName: "Launch", unit: "events" },
});

/** Decides a counted month and records whatever decision it intends, as the pipeline does. */
async function decideAndRecord(state: LimitState, data: MonthCountedEventData) {
  const result = monthCounted(state, data, ctx);
  const recorded = [];
  for (const intent of result.intents ?? []) {
    const payload: RecordLimitDecisionCommandData = recordLimitDecisionCommandDataSchema.parse(
      intent.payload,
    );
    recorded.push(
      ...(await new RecordLimitDecisionCommand().handle({
        tenantId: createTenantId(payload.tenantId),
        aggregateId: payload.organizationId,
        type: RecordLimitDecisionCommand.schema.type,
        data: payload,
      })),
    );
  }
  return { result, recorded };
}

describe("usage's limit decision", () => {
  describe("given the organization's month's count reaches 1,000", () => {
    describe("when usage counts the organization's month", () => {
      /** @scenario "Crossing the allowance records the limit as reached" */
      it("records limit_reached with the count, the allowance, the plan name and the unit", async () => {
        const { recorded } = await decideAndRecord(
          { month: null, reached: false },
          counted(1_000, 1_000),
        );

        expect(recorded.map(({ type, data }) => ({ type, data }))).toEqual([
          {
            type: USAGE_LIMIT_REACHED_EVENT_TYPE,
            data: expect.objectContaining({
              count: 1_000,
              allowance: 1_000,
              planName: "Launch",
              unit: "events",
            }),
          },
        ]);
      });
    });
  });

  describe("given the limit is already recorded as reached this month", () => {
    describe("when usage counts the organization's month again", () => {
      /** @scenario "Counting again past the allowance records nothing new" */
      it("records no further limit event", async () => {
        const { recorded } = await decideAndRecord(
          { month: "2026-10", reached: true },
          counted(1_200, 1_000),
        );

        expect(recorded).toEqual([]);
      });
    });
  });

  describe("given the limit is recorded as reached and the plan is raised to 10,000", () => {
    describe("when the refused organization's process manager wakes", () => {
      /** @scenario "An upgrade clears a reached limit" */
      it("recounts the month and records limit_cleared", async () => {
        const reached = { month: "2026-10", reached: true };
        const wake = refusedOrganizationWake(reached, ctx);
        const { recorded } = await decideAndRecord(reached, counted(1_200, 10_000));

        expect(wake.intents?.map((intent) => intent.intentType)).toEqual(["countMonth"]);
        expect(recorded.map(({ type }) => type)).toEqual([USAGE_LIMIT_CLEARED_EVENT_TYPE]);
      });
    });
  });
});
