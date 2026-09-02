import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_DEFAULT_DATA_PRIVACY } from "@langwatch/data-privacy-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerTraceCapabilityServices,
  type WorkerTraceCapabilityDatabase,
} from "../worker-trace-capability-services.composition";
import { createWorkerTraceContentDrop } from "../worker-trace-content-drop.composition";
import { createWorkerTraceCostEnrichment } from "../worker-trace-cost-enrichment.composition";
import {
  createWorkerTraceEvaluationMonitorPort,
  createWorkerTraceModelCostCatalogPort,
  createWorkerTraceNarrowPorts,
} from "../worker-trace-narrow-ports.composition";
import { TraceProductAnalyticsPort, type TraceProductEvent } from "@langwatch/trace-server";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 *
 * A COMPOSITION-CAPABILITY test, and the one that closes the trace
 * conversion's second halt. Trace has not converted, so nothing in this process
 * reads a project or resolves a policy. What has to be true today is that the
 * four capability services `command:recordSpan` and its subscribers read
 * through can be built from a Prisma client and NOTHING else — no
 * `OrganizationService`, no `AuthzService`, no `EvaluatorService`, no
 * credentials port, no LWQL key map, no S3 deleter. Each is driven through the
 * port its consumer names, because a service that composes and answers nothing
 * is exactly the failure this wave exists to prevent.
 */

const NOW = new Date("2026-09-02T00:00:00.000Z");

function projectRow(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

type FakeDatabase = {
  database: WorkerTraceCapabilityDatabase;
  projectFindUnique: ReturnType<typeof vi.fn>;
  projectUpdate: ReturnType<typeof vi.fn>;
  policyFindMany: ReturnType<typeof vi.fn>;
  costFindMany: ReturnType<typeof vi.fn>;
  monitorFindMany: ReturnType<typeof vi.fn>;
};

function fakeDatabase(
  options: {
    policies?: unknown[];
    costs?: unknown[];
    monitors?: unknown[];
    adminUserId?: string | null;
  } = {},
): FakeDatabase {
  const projectFindUnique = vi.fn(async (query: Record<string, any>) => {
    if (query.select) {
      return {
        firstMessage: true,
        team: {
          organization: {
            id: "organization-1",
            members:
              options.adminUserId === null ? [] : [{ userId: options.adminUserId ?? "user-1" }],
          },
        },
      };
    }
    if (query.include?.team) {
      return { ...projectRow(), team: teamRow() };
    }
    return projectRow();
  });
  const projectUpdate = vi.fn(async () => projectRow());
  const policyFindMany = vi.fn(async () => options.policies ?? []);
  const costFindMany = vi.fn(async () => options.costs ?? []);
  const monitorFindMany = vi.fn(async () => options.monitors ?? []);

  return {
    database: {
      project: { findUnique: projectFindUnique, update: projectUpdate },
      team: {},
      dataPrivacyPolicy: { findMany: policyFindMany },
      customLLMModelCost: { findMany: costFindMany },
      monitor: { findMany: monitorFindMany },
    } as unknown as WorkerTraceCapabilityDatabase,
    projectFindUnique,
    projectUpdate,
    policyFindMany,
    costFindMany,
    monitorFindMany,
  };
}

class RecordingProductAnalytics extends TraceProductAnalyticsPort {
  readonly captured: TraceProductEvent[] = [];

  record(event: TraceProductEvent): void {
    this.captured.push(event);
  }
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

describe("createWorkerTraceCapabilityServices", () => {
  describe("given nothing but the process's own Prisma client", () => {
    describe("when the four capability services are composed", () => {
      /** @scenario "The record path's capability services compose from a database alone" */
      it("builds all four without an organization, authz, evaluator or credentials collaborator", () => {
        const { database } = fakeDatabase();

        const services = createWorkerTraceCapabilityServices({ database });

        expect(Object.keys(services).sort()).toEqual([
          "dataPrivacy",
          "modelCosts",
          "monitors",
          "projects",
        ]);
      });
    });

    describe("when the project metadata port is driven", () => {
      /** @scenario "The project reads answer through the port the subscribers name" */
      it("reads the project, stamps its metadata and resolves the organization admin", async () => {
        const fake = fakeDatabase();
        const services = createWorkerTraceCapabilityServices({ database: fake.database });
        const ports = createWorkerTraceNarrowPorts({
          projects: services.projects,
          monitors: services.monitors,
          modelProviders: services.modelCosts,
          productAnalytics: new RecordingProductAnalytics(),
        });

        await expect(ports.projects.tryGetById("project-1")).resolves.toMatchObject({
          id: "project-1",
          slug: "checkout-assistant",
        });
        await ports.projects.updateMetadata({
          id: "project-1",
          data: { firstMessage: true, integrated: true, language: "python" },
        });
        await expect(ports.projects.resolveOrgAdmin("project-1")).resolves.toEqual({
          userId: "user-1",
          organizationId: "organization-1",
          firstMessage: true,
        });

        expect(fake.projectUpdate).toHaveBeenCalledWith({
          where: { id: "project-1" },
          data: { firstMessage: true, integrated: true, language: "python" },
        });
      });

      /** @scenario "A failing organization-admin read does not fail the fold that asked" */
      it("answers an empty resolution when the read throws", async () => {
        const fake = fakeDatabase();
        fake.projectFindUnique.mockRejectedValueOnce(new Error("connection reset"));
        const captured: Array<Record<string, unknown>> = [];
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          diagnostics: {
            error: (context: Record<string, unknown>) => captured.push(context),
            capture: () => void 0,
          },
        });

        await expect(services.projects.resolveOrgAdmin("project-1")).resolves.toEqual({
          userId: null,
          organizationId: null,
          firstMessage: false,
        });
        expect(captured).toHaveLength(1);
      });
    });

    describe("when the privacy policy is resolved through the content-drop port", () => {
      /** @scenario "A customer's drop is honoured from the policy rows alone" */
      it("drops the input a stored policy asked to drop", async () => {
        const fake = fakeDatabase({
          policies: [
            {
              scopeType: "PROJECT",
              scopeId: "project-1",
              personalOnly: false,
              config: {
                categories: {
                  input: { disposition: "drop" },
                },
              },
            },
          ],
        });
        const services = createWorkerTraceCapabilityServices({ database: fake.database });

        const drop = createWorkerTraceContentDrop({
          dataPrivacy: services.dataPrivacy,
          nativePolicyEnforced: true,
        }).spanContentDropPort();
        const target = span();
        const result = await drop.drop(target, "project-1");

        expect(result.droppedCategories).toEqual(["input"]);
        expect(target.attributes.map((attribute) => attribute.key)).not.toContain("gen_ai.prompt");
        expect(fake.policyFindMany).toHaveBeenCalledWith({
          where: {
            organizationId: "organization-1",
            OR: expect.arrayContaining([{ scopeType: "PROJECT", scopeId: "project-1" }]),
          },
        });
      });

      /** @scenario "A project with no stored policy keeps its content" */
      it("keeps the input when no policy row asks for a drop", async () => {
        const { database } = fakeDatabase();
        const services = createWorkerTraceCapabilityServices({ database });

        const drop = createWorkerTraceContentDrop({
          dataPrivacy: services.dataPrivacy,
          nativePolicyEnforced: true,
        }).spanContentDropPort();
        const target = span();
        const result = await drop.drop(target, "project-1");

        expect(result.droppedCount).toBe(0);
        expect(target.attributes.map((attribute) => attribute.key)).toContain("gen_ai.prompt");
        expect(PLATFORM_DEFAULT_DATA_PRIVACY.categories.input.disposition).not.toBe("drop");
      });
    });

    describe("when the cost catalogue is read through the enrichment port", () => {
      /** @scenario "A customer's own rate prices the span" */
      it("prices the span from the rules stored under the project's scopes", async () => {
        const fake = fakeDatabase({
          costs: [
            {
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
            },
          ],
        });
        const services = createWorkerTraceCapabilityServices({ database: fake.database });

        const enrichment = createWorkerTraceCostEnrichment({
          modelCosts: createWorkerTraceModelCostCatalogPort(services.modelCosts),
        }).spanCostEnrichmentPort();
        const target = span();
        await enrichment.enrich(target, "project-1");

        expect(
          target.attributes
            .filter((attribute) => attribute.key.startsWith("langwatch.model."))
            .map((attribute) => [attribute.key, attribute.value.doubleValue]),
        ).toEqual([
          ["langwatch.model.inputCostPerToken", 0.001],
          ["langwatch.model.outputCostPerToken", 0.002],
        ]);
        expect(fake.costFindMany).toHaveBeenCalledWith(
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

      /** @scenario "A project that cannot be read prices nothing rather than failing" */
      it("lists no costs when the project is gone", async () => {
        const fake = fakeDatabase();
        fake.projectFindUnique.mockResolvedValue(null);
        const services = createWorkerTraceCapabilityServices({ database: fake.database });

        await expect(services.modelCosts.listCosts({ projectId: "project-1" })).resolves.toEqual(
          [],
        );
        expect(fake.costFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when this process's own modules are read", () => {
      /**
       * STAGED means the same two things it meant for the pipeline: nothing
       * outside a test reaches these compositions, and the record path they
       * would build is still the application's. A capability service that
       * composes is not a capability service that runs, and mounting one half
       * of the record path is exactly what the halt refused.
       *
       * @scenario "The record path's capability services compose from a database alone" */
      it("has no production caller but the record-span composition", () => {
        const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
        const files: string[] = [];
        const walk = (directory: string) => {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".ts")) files.push(path);
          }
        };
        walk(sourceRoot);

        // A moved or renamed source root must fail here rather than pass on an
        // empty list.
        expect(files.length).toBeGreaterThan(50);

        const callersOf = (module: string) =>
          files
            .filter(
              (file) => !file.includes("__tests__") && readFileSync(file, "utf8").includes(module),
            )
            .map((file) => file.slice(sourceRoot.length));

        expect(callersOf("worker-record-span.composition")).toEqual([]);
        expect(callersOf("worker-feature-flags.composition")).toEqual([]);
        expect(callersOf("worker-trace-capability-services.composition")).toEqual([
          "app/worker-record-span.composition.ts",
        ]);
      });
    });

    describe("when the monitor listing is read through its port", () => {
      /** @scenario "The evaluation trigger reads a project's on-message monitors" */
      it("lists only the enabled on-message monitors of that project", async () => {
        const fake = fakeDatabase({
          monitors: [
            {
              id: "monitor-1",
              checkType: "langevals/basic",
              name: "Answer relevancy",
              threadIdleTimeout: null,
              evaluator: { name: "relevancy" },
            },
          ],
        });
        const services = createWorkerTraceCapabilityServices({ database: fake.database });

        const monitors = createWorkerTraceEvaluationMonitorPort(services.monitors);

        await expect(monitors.getEnabledOnMessageMonitors("project-1")).resolves.toEqual([
          {
            id: "monitor-1",
            checkType: "langevals/basic",
            name: "Answer relevancy",
            threadIdleTimeout: null,
            evaluator: { name: "relevancy" },
          },
        ]);
        expect(fake.monitorFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { projectId: "project-1", enabled: true, executionMode: "ON_MESSAGE" },
          }),
        );
      });
    });
  });
});
