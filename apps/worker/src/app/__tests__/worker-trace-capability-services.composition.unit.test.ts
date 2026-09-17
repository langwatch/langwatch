import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  resolveDataPrivacy,
  type DataPrivacyRow,
} from "@langwatch/data-privacy-contract";
import type { DataPrivacyResolution } from "@langwatch/data-privacy-server";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerTraceCapabilityServices,
  type WorkerTraceCapabilityDatabase,
  type WorkerTraceCapabilityProjects,
} from "../worker-trace-capability-services.composition.ts";
import { createWorkerTraceContentDrop } from "../worker-trace-content-drop.composition.ts";
import { createWorkerTraceCostEnrichment } from "../worker-trace-cost-enrichment.composition.ts";
import {
  createWorkerTraceEvaluationMonitorPort,
  createWorkerTraceModelCostCatalogPort,
  createWorkerTraceNarrowPorts,
} from "../worker-trace-narrow-ports.composition.ts";
import type { TraceProductAnalytics, TraceProductEvent } from "@langwatch/trace-server";

/**
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 * Four capability services for recordSpan, each taken from the application the
 * process installed and driven through its consumer's port.
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
  /** The installed project application, as the composition names it. */
  projects: WorkerTraceCapabilityProjects;
  /** The resolution the process hands the record path, over the same rows. */
  dataPrivacy: DataPrivacyResolution;
  projectFindUnique: ReturnType<typeof vi.fn>;
  projectUpdate: ReturnType<typeof vi.fn>;
  policyFindMany: ReturnType<typeof vi.fn>;
  costFindMany: ReturnType<typeof vi.fn>;
  monitorFindMany: ReturnType<typeof vi.fn>;
  /** The listing the process installs once and hands the record path. */
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
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
  const projectUpdate = vi.fn(async (_query: Record<string, unknown>) => projectRow());
  const policyFindMany = vi.fn(async () => options.policies ?? []);
  const costFindMany = vi.fn(async () => options.costs ?? []);
  const monitorFindMany = vi.fn(async () => options.monitors ?? []);

  const projects: WorkerTraceCapabilityProjects = {
    findById: async (id) => (await projectFindUnique({ where: { id } })) as never,
    updateMetadata: async (input) => {
      await projectUpdate({ where: { id: input.id }, data: input.data } as never);
    },
    resolveOrgAdmin: async (projectId) => {
      const read = (await projectFindUnique({
        where: { id: projectId },
        select: { firstMessage: true, team: true },
      })) as {
        firstMessage: boolean;
        team: { organization: { id: string; members: { userId: string }[] } };
      };

      return {
        userId: read.team.organization.members[0]?.userId ?? null,
        organizationId: read.team.organization.id,
        firstMessage: read.firstMessage,
      };
    },
    findWithTeam: async (id) =>
      (await projectFindUnique({ where: { id }, include: { team: true } })) as never,
    getWithTeam: async (id) =>
      (await projectFindUnique({ where: { id }, include: { team: true } })) as never,
  };

  return {
    projects,
    database: {
      project: { findUnique: projectFindUnique, update: projectUpdate },
      team: {},
      dataPrivacyPolicy: { findMany: policyFindMany },
      customLLMModelCost: { findMany: costFindMany },
      monitor: { findMany: monitorFindMany },
    } as unknown as WorkerTraceCapabilityDatabase,
    monitors: { getEnabledOnMessageMonitors: monitorFindMany },
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
    projectFindUnique,
    projectUpdate,
    policyFindMany,
    costFindMany,
    monitorFindMany,
  };
}

class RecordingProductAnalytics implements TraceProductAnalytics {
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
      /** @scenario "The record path's capability services are taken from the one graph" */
      it("builds all four over the applications this process installed", () => {
        const { database, projects, dataPrivacy, monitors } = fakeDatabase();

        const services = createWorkerTraceCapabilityServices({
          database,
          projects,
          dataPrivacy,
          monitors,
        });

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
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          projects: fake.projects,
          dataPrivacy: fake.dataPrivacy,
          monitors: fake.monitors,
        });
        const ports = createWorkerTraceNarrowPorts({
          projects: services.projects,
          monitors: services.monitors,
          modelProviders: services.modelCosts,
          productAnalytics: new RecordingProductAnalytics(),
        });

        await expect(ports.projects.findById("project-1")).resolves.toMatchObject({
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
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          projects: fake.projects,
          dataPrivacy: fake.dataPrivacy,
          monitors: fake.monitors,
        });

        const drop = createWorkerTraceContentDrop({
          dataPrivacy: services.dataPrivacy,
          nativePolicyEnforced: true,
        }).spanContentDropPort();
        const target = span();
        const result = await drop.drop(target, "project-1");

        expect(result.droppedCategories).toEqual(["input"]);
        expect(target.attributes.map((attribute) => attribute.key)).not.toContain("gen_ai.prompt");
        // The port the process handed in, and not a second resolution built
        // here: the record path reads the SAME policy the privacy surface does.
        expect(services.dataPrivacy).toBe(fake.dataPrivacy);
      });

      /** @scenario "A project with no stored policy keeps its content" */
      it("keeps the input when no policy row asks for a drop", async () => {
        const { database, projects, dataPrivacy, monitors } = fakeDatabase();
        const services = createWorkerTraceCapabilityServices({
          database,
          projects,
          dataPrivacy,
          monitors,
        });

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
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          projects: fake.projects,
          dataPrivacy: fake.dataPrivacy,
          monitors: fake.monitors,
        });

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
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          projects: fake.projects,
          dataPrivacy: fake.dataPrivacy,
          monitors: fake.monitors,
        });

        await expect(services.modelCosts.listCosts({ projectId: "project-1" })).resolves.toEqual(
          [],
        );
        expect(fake.costFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when this process's own modules are read", () => {
      /**
       * MOUNTED, and the caller list is the assertion. These three used to have
       * no production caller at all — that was the staged slice — and each one
       * now has exactly the caller the conversion gives it: the record command
       * and the flag store are reached by the pipeline composition, and the
       * capability services by both. Naming them rather than counting them is
       * what would catch a SECOND graph composing its own copy: two flag
       * services in one process halve the cache hit rate and can disagree for a
       * TTL about whether a kill switch is thrown.
       *
       * @scenario "The record path's capability services are taken from the one graph" */
      it("is reached only by the compositions the conversion gives it", () => {
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

        expect(callersOf("worker-record-span.composition")).toEqual([
          "app/worker-trace-processing-pipeline.composition.ts",
        ]);
        // The flag application is the installed module's now, read off the one
        // booted graph, so no composition in this process builds a second one.
        expect(callersOf("worker-feature-flags.composition")).toEqual([]);
        expect(callersOf("worker-trace-capability-services.composition").sort()).toEqual([
          "app/worker-production.composition.ts",
          "app/worker-record-span.composition.ts",
          "app/worker-trace-processing-pipeline.composition.ts",
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
        const services = createWorkerTraceCapabilityServices({
          database: fake.database,
          projects: fake.projects,
          dataPrivacy: fake.dataPrivacy,
          monitors: fake.monitors,
        });

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
        // The enabled/ON_MESSAGE filter belongs to the monitor application this
        // process installs once, not to this composition: the port is asked for a
        // project and answers that project's listing.
        expect(fake.monitorFindMany).toHaveBeenCalledWith("project-1");
      });
    });
  });
});
