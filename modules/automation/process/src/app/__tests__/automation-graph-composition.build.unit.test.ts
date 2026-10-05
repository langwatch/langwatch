/** @see specs/trace-processing/worker-record-span-capability-services.feature */
import type { AnalyticsService } from "@langwatch/analytics-contract";
import { frozenAt } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  breachingAnalytics,
  createGraphActivityPrismaDouble,
  FROZEN_NOW,
  graphTriggerRow,
  RecordingDelivery,
  SilentLogger,
  TestDispatchErrors,
} from "../../__tests__/fixtures/graph-activity.fixture.ts";
import { MemoryAutomationEmailCapRepository } from "../../repositories/memory/memory.automation-email-cap.repository.ts";
import { AutomationEmailCapService } from "../../services/email-cap.service.ts";
import { SlackDestinationService } from "../../services/slack-destination.service.ts";
import { composeAutomationGraphActivity } from "../automation-graph-composition.build.ts";
import type { AutomationProjectDirectory } from "../automation.members.ts";

const crypto = { encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };

function composeOver(input: { projects: AutomationProjectDirectory; analytics: AnalyticsService }) {
  const database = createGraphActivityPrismaDouble({ triggers: [graphTriggerRow()] });
  const delivery = new RecordingDelivery();
  const vertical = composeAutomationGraphActivity({
    prisma: database.prisma,
    clock: frozenAt(FROZEN_NOW),
    projects: input.projects,
    analytics: input.analytics,
    delivery,
    crypto,
    slackDestinations: SlackDestinationService.create({
      slack: { findUsableSlackSecret: async () => [] },
      crypto,
    }),
    emailCaps: AutomationEmailCapService.create({
      store: MemoryAutomationEmailCapRepository.create(),
      fallback: MemoryAutomationEmailCapRepository.create(),
    }),
    logger: new SilentLogger(),
    dispatchErrors: new TestDispatchErrors(),
    baseHost: "https://app.langwatch.test",
    emailHourlyCap: 100,
    tenantDailyCap: 10_000,
  });

  return { vertical, delivery };
}

describe("composeAutomationGraphActivity", () => {
  describe("given the project reads the process composed", () => {
    describe("when the graph-alert vertical is composed over them", () => {
      /** @scenario "The graph vertical takes the project reads this process composes" */
      it("is built from the project directory and the analytics reads alone", async () => {
        const asked: string[] = [];
        const { vertical, delivery } = composeOver({
          projects: {
            findById: async (projectId) => {
              asked.push(projectId);
              return { id: projectId, name: "Acme", slug: "acme" };
            },
          },
          analytics: breachingAnalytics(),
        });

        const result = await vertical.evaluateGraphTrigger({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "real-time",
        });

        expect(result.status).toBe("fired");
        expect(asked).toEqual(["project-1"]);
        expect(delivery.emails).toHaveLength(1);
      });
    });
  });
});
