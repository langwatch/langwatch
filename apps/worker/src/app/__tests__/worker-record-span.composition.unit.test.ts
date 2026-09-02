import { createTenantId, type Command } from "@langwatch/eventing";
import type { OtlpSpan, RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { createWorkerFeatureFlags } from "../worker-feature-flags.composition";
import { createWorkerRecordSpanCommand } from "../worker-record-span.composition";
import {
  createWorkerTraceCapabilityServices,
  type WorkerTraceCapabilityDatabase,
} from "../worker-trace-capability-services.composition";
import type { WorkerFeatureFlagDatabase } from "../worker-feature-flags.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 *
 * A COMPOSITION-CAPABILITY test, and the one that answers the halt directly.
 * The step-(g) attempt stopped because `command:recordSpan` took four ports
 * that each took a capability service by parameter, and not one of the six was
 * constructible in this process. This builds the command from a Prisma client,
 * a resolved configuration and nothing else, and then FOLDS A REAL SPAN
 * through it — because a command that assembles and then drops a customer's
 * policy, or prices every span at zero, is structurally identical to one that
 * works.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function projectRow() {
  return {
    id: "project-1",
    name: "Checkout Assistant",
    slug: "checkout-assistant",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "python",
    framework: "openai",
    kind: "default",
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function teamRow() {
  return {
    id: "team-1",
    name: "Payments",
    slug: "payments",
    organizationId: "organization-1",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  };
}

function database(options: { policies?: unknown[]; costs?: unknown[] } = {}) {
  return {
    project: {
      findUnique: vi.fn(async (query: Record<string, any>) =>
        query.include?.team ? { ...projectRow(), team: teamRow() } : projectRow(),
      ),
      update: vi.fn(async () => projectRow()),
    },
    team: {},
    // Filters the way the real table does. A double that answers every query
    // with the same rows cannot tell a policy read inside this tenant's
    // organization from one that reached another's, and a sabotage that
    // resolved the chain under the wrong organization came back green against
    // the first draft of this fake.
    dataPrivacyPolicy: {
      findMany: vi.fn(async (query: Record<string, any>) =>
        query.where?.organizationId === "organization-1" ? (options.policies ?? []) : [],
      ),
    },
    customLLMModelCost: { findMany: vi.fn(async () => options.costs ?? []) },
    monitor: { findMany: vi.fn(async () => []) },
    featureFlag: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    featureFlagExperimentSetting: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
  } as unknown as WorkerTraceCapabilityDatabase & WorkerFeatureFlagDatabase;
}

function customerRate() {
  return {
    id: "cost-1",
    organizationId: "organization-1",
    projectId: "project-1",
    scopeType: "PROJECT",
    scopeId: "project-1",
    model: "acme-1",
    regex: "^acme-1$",
    inputCostPerToken: 0.001,
    outputCostPerToken: 0.002,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function dropInputPolicy() {
  return {
    scopeType: "PROJECT",
    scopeId: "project-1",
    personalOnly: false,
    config: { categories: { input: { disposition: "drop" } } },
  };
}

function span(): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes: [
      { key: "gen_ai.prompt", value: { stringValue: "a customer's prompt" } },
      { key: "gen_ai.request.model", value: { stringValue: "acme-1" } },
      { key: "gen_ai.usage.input_tokens", value: { intValue: 100 } },
      { key: "gen_ai.usage.output_tokens", value: { intValue: 10 } },
    ],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function recordSpan(): Command<RecordSpanCommandData> {
  return {
    tenantId: createTenantId("project-1"),
    aggregateId: "trace-1",
    type: "trace.recordSpan" as Command<RecordSpanCommandData>["type"],
    data: {
      tenantId: "project-1",
      span: span() as RecordSpanCommandData["span"],
      resource: null,
      instrumentationScope: null,
      occurredAt: NOW.getTime(),
    },
  };
}

function composeCommand(options: { policies?: unknown[]; costs?: unknown[] } = {}) {
  const config = resolveWorkerConfig({});
  const prisma = database(options);
  const services = createWorkerTraceCapabilityServices({ database: prisma });

  return {
    prisma,
    command: createWorkerRecordSpanCommand({
      config,
      services,
      featureFlags: createWorkerFeatureFlags({ database: prisma, config, redis: null }),
    }),
  };
}

describe("createWorkerRecordSpanCommand", () => {
  describe("given a Prisma client and a resolved worker configuration", () => {
    describe("when the record command is composed", () => {
      /** @scenario "The record command composes from a database and a configuration" */
      it("builds the whole command without a capability service being handed in", () => {
        const { command } = composeCommand();

        expect(typeof command.handle).toBe("function");
      });
    });

    describe("when a span is folded through the composed command", () => {
      /** @scenario "A folded span carries the customer's rates and keeps its content" */
      it("prices the span from the project's own rules", async () => {
        const { command } = composeCommand({ costs: [customerRate()] });

        const [event] = await command.handle(recordSpan());

        expect(
          event?.data.span.attributes
            .filter((attribute) => attribute.key.startsWith("langwatch.model."))
            .map((attribute) => [attribute.key, attribute.value.doubleValue]),
        ).toEqual([
          ["langwatch.model.inputCostPerToken", 0.001],
          ["langwatch.model.outputCostPerToken", 0.002],
        ]);
        expect(event?.data.span.attributes.map((attribute) => attribute.key)).toContain(
          "gen_ai.prompt",
        );
      });

      /** @scenario "A folded span honours a stored drop policy" */
      it("removes the content the customer asked to be dropped", async () => {
        const { prisma, command } = composeCommand({ policies: [dropInputPolicy()] });

        const [event] = await command.handle(recordSpan());

        expect(event?.data.span.attributes.map((attribute) => attribute.key)).not.toContain(
          "gen_ai.prompt",
        );
        const policies = prisma.dataPrivacyPolicy as unknown as {
          findMany: ReturnType<typeof vi.fn>;
        };
        for (const call of policies.findMany.mock.calls) {
          expect(call[0].where.organizationId).toBe("organization-1");
        }
      });

      /** @scenario "The fold reads the tenant's own project and nothing wider" */
      it("scopes every read to the tenant on the command", async () => {
        const { prisma, command } = composeCommand({ costs: [customerRate()] });

        await command.handle(recordSpan());

        const project = prisma.project as unknown as {
          findUnique: ReturnType<typeof vi.fn>;
        };
        for (const call of project.findUnique.mock.calls) {
          expect(call[0].where).toMatchObject({ id: "project-1" });
        }
        const costs = prisma.customLLMModelCost as unknown as {
          findMany: ReturnType<typeof vi.fn>;
        };
        expect(costs.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              OR: [
                { scopeType: "PROJECT", scopeId: "project-1" },
                { scopeType: "TEAM", scopeId: "team-1" },
                { scopeType: "ORGANIZATION", scopeId: "organization-1" },
              ],
            },
          }),
        );
      });
    });
  });
});
