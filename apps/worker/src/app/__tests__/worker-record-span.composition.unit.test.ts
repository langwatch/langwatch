import type { CustomLLMModelCost } from "@langwatch/prisma-client/generated";
import { resolveDataPrivacy, type DataPrivacyRow } from "@langwatch/data-privacy-contract";
import { createTenantId, type Command } from "@langwatch/eventing";
import type { OtlpSpan, RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { createWorkerRecordSpanCommand } from "../worker-record-span.composition.ts";
import {
  createWorkerTraceCapabilityServices,
  type WorkerTraceCapabilityDatabase,
  type WorkerTraceCapabilityProjects,
} from "../worker-trace-capability-services.composition.ts";
import { resolveWorkerConfig } from "../../platform/config/worker.config.ts";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 * Builds command from Prisma client and configuration alone; folds real spans
 * through to test assembly and policy handling.
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

function database(options: { policies?: unknown[]; costs?: CustomLLMModelCost[] } = {}) {
  const customLLMModelCost = createApiFixture<WorkerTraceCapabilityDatabase["customLLMModelCost"]>({
    findMany: () => {
      throw new Error("The test must configure the model cost query");
    },
  });
  vi.spyOn(customLLMModelCost, "findMany").mockResolvedValue(options.costs ?? []);

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
    customLLMModelCost,
    monitor: { findMany: vi.fn(async () => []) },
    featureFlag: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    featureFlagExperimentSetting: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
  };
}

function customerRate(): CustomLLMModelCost {
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

/**
 * The five project reads the record path makes, answered off the fake rows the
 * database double holds — this is what the process hands in as the installed
 * project application.
 */
function projectsOver(prisma: ReturnType<typeof database>): WorkerTraceCapabilityProjects {
  const project = prisma.project;

  return {
    findById: async (id) => (await project.findUnique({ where: { id } })) as never,
    updateMetadata: async () => void 0,
    resolveOrgAdmin: async () => ({
      userId: null,
      organizationId: "organization-1",
      firstMessage: false,
    }),
    findWithTeam: async (id) =>
      (await project.findUnique({ where: { id }, include: { team: true } })) as never,
    getWithTeam: async (id) =>
      (await project.findUnique({ where: { id }, include: { team: true } })) as never,
  };
}

function composeCommand(options: { policies?: unknown[]; costs?: CustomLLMModelCost[] } = {}) {
  const config = resolveWorkerConfig({});
  const prisma = database(options);
  const services = createWorkerTraceCapabilityServices({
    database: prisma,
    monitors: { getEnabledOnMessageMonitors: async () => [] },
    // The installed project application, over the SAME rows the fake database
    // holds: the record path reads a project, it does not open a directory.
    projects: projectsOver(prisma),
    // The resolution the process hands in, over the SAME rows the fake
    // database holds: the record path reads a policy, it does not query one.
    dataPrivacy: {
      getResolvedForProject: async () =>
        resolveDataPrivacy({
          rows: (options.policies ?? []) as DataPrivacyRow[],
          facts: {
            organizationId: "organization-1",
            teamId: "team-1",
            projectId: "project-1",
            departmentId: null,
            isPersonal: false,
          },
        }),
    },
  });

  return {
    prisma,
    command: createWorkerRecordSpanCommand({
      config,
      services,
      // No switch is thrown in this world: the command's two kill switches are
      // read, and both answer off.
      featureFlags: createApiFixture<FeatureFlagApi>(
        { isEnabled: async () => false },
        "record span flags",
      ),
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
        const { command } = composeCommand({ policies: [dropInputPolicy()] });

        const [event] = await command.handle(recordSpan());

        expect(event?.data.span.attributes.map((attribute) => attribute.key)).not.toContain(
          "gen_ai.prompt",
        );
      });

      /** @scenario "The fold reads the tenant's own project and nothing wider" */
      it("scopes every read to the tenant on the command", async () => {
        const { prisma, command } = composeCommand({ costs: [customerRate()] });

        await command.handle(recordSpan());

        const project = prisma.project;
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
