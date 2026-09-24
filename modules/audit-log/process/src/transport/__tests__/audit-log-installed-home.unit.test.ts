/**
 * @vitest-environment node
 * @see modules/audit-log/specs/audit-log.feature
 */
import type { AnnotationApi, AnnotationQueueDetail } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { SessionReader } from "@langwatch/api/rest";
import { TrpcHost } from "@langwatch/api/trpc";
import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { Dataset, DatasetApi } from "@langwatch/dataset-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { Monitor, MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  WorkflowNotFoundError,
  type WorkflowApi,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { auditLogServer } from "../../audit-log.server.ts";
import { homeTrpcTransport } from "../home.trpc.ts";

const ACTOR = { id: "user-1" };
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization-1";
const PERMITTED = { permitted: true, organizationRole: null };
const AT = new Date("2026-09-01T00:00:00.000Z");

const workflowFixture: WorkflowWithVersion = {
  id: "wf",
  projectId: PROJECT_ID,
  name: "Flow",
  icon: null,
  description: null,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
};

const datasetFixture: Dataset = {
  id: "ds",
  projectId: PROJECT_ID,
  name: "Golden",
  slug: "golden",
  columnTypes: [],
  createdAt: AT,
  updatedAt: AT,
  archivedAt: null,
  mapping: null,
  useS3: false,
  s3RecordCount: null,
  contentLayout: "postgres",
  status: "ready",
  statusError: null,
  stagingKey: null,
  uploadFilename: null,
  rowCount: null,
  sizeBytes: null,
  chunkCount: null,
  chunkOffsets: null,
};

const monitorFixture: Monitor = {
  id: "monitor",
  projectId: PROJECT_ID,
  experimentId: null,
  evaluatorId: null,
  checkType: "custom/basic",
  name: "Toxicity",
  slug: "toxicity",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: null,
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: AT,
  updatedAt: AT,
};

const queueFixture: AnnotationQueueDetail = {
  id: "queue",
  name: "Review",
  slug: "review",
  projectId: PROJECT_ID,
  description: null,
  createdAt: AT,
  updatedAt: AT,
  members: [],
  AnnotationQueueScores: [],
};

type Owners = Readonly<{
  project: ProjectApi;
  prompt: PromptApi;
  workflow: WorkflowApi;
  dataset: DatasetApi;
  monitor: MonitorApi;
  annotation: AnnotationApi;
}>;

function owners(): Owners {
  const prompts = [
    { id: "prompt-live", name: "support-reply" },
    { id: "prompt-deleted", name: "old-reply" },
  ];
  return {
    project: createApiFixture<ProjectApi>({
      findSummaryById: async () => ({ name: "Acme", slug: "acme" }),
      findOrganizationId: async () => ORGANIZATION_ID,
    }),
    prompt: createApiFixture<PromptApi>({
      getExistingIds: async ({ ids }) => ids.filter((id) => id === "prompt-live"),
      getNamesByIds: async ({ ids }) => prompts.filter((prompt) => ids.includes(prompt.id)),
    }),
    workflow: createApiFixture<WorkflowApi>({
      getById: async ({ id, projectId }) => {
        if (id === "wf-gone") throw new WorkflowNotFoundError(id, projectId);
        return { ...workflowFixture, id, archivedAt: id === "wf-archived" ? new Date() : null };
      },
    }),
    dataset: createApiFixture<DatasetApi>({
      getByIds: async ({ datasetIds }) =>
        datasetIds.map((id) => ({ ...datasetFixture, id, archivedAt: null })),
    }),
    monitor: createApiFixture<MonitorApi>({
      getAllByIds: async ({ monitorIds }) => monitorIds.map((id) => ({ ...monitorFixture, id })),
    }),
    annotation: createApiFixture<AnnotationApi>({
      getQueue: async ({ queueId }) => ({ ...queueFixture, id: queueId ?? queueFixture.id }),
    }),
  };
}

async function installed(peers: Owners = owners()) {
  const runtime = await createApp({ role: "api" })
    .withModules([withMemoryRepositories(auditLogServer)])
    .withConfig({ "audit-log": undefined })
    .provide(peers)
    .boot();
  const host = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: ACTOR.id }) }),
    authz: {
      getDecision: async () => PERMITTED,
      getProjectAnyDecision: async () => PERMITTED,
      checkScopeLineage: async () => ({ kind: "consistent" }),
    },
  });
  host.mount(homeTrpcTransport, () => runtime.module(auditLogServer).provided);

  return { runtime, host, audit: runtime.service(AuditLogApi) };
}

async function readStrip(host: TrpcHost, input: { projectId: string; limit?: number }) {
  const encoded = encodeURIComponent(JSON.stringify(input));
  const request = new Request(`http://api.test/api/trpc/home.getRecentItems?input=${encoded}`);
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: host.router,
    createContext: () => host.context({ request }),
  });

  return { status: response.status, body: await response.json() };
}

function touched(action: string, args: Record<string, string>, userId = ACTOR.id) {
  return { userId, projectId: PROJECT_ID, action, args } satisfies RecordAuditLogCommand;
}

describe("given the audit log installed over memory repositories", () => {
  describe("when somebody with no recent activity reads the home strip", () => {
    /** @scenario "the home strip answers an empty trail with no items" */
    /** @scenario "Returns empty array when user has no recent activity" */
    it("answers no items", async () => {
      const { runtime, host } = await installed();

      try {
        expect(await readStrip(host, { projectId: PROJECT_ID })).toEqual({
          status: 200,
          body: { result: { data: [] } },
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when somebody reads the strip after touching entities", () => {
    /** @scenario "the home strip lists what the caller touched, newest first and each once" */
    /** @scenario "Extracts prompt IDs from prompts.update actions" */
    /** @scenario "Extracts workflow IDs from workflow.update actions" */
    /** @scenario "Extracts dataset IDs from dataset.update actions" */
    it("lists each entity once at its newest touch, named and linked by its owner", async () => {
      const { runtime, host, audit } = await installed();

      try {
        await audit.record(touched("workflow.create", { workflowId: "wf-1" }));
        await audit.record(touched("prompts.update", { configId: "prompt-live" }));
        await audit.record(touched("monitors.update", { checkId: "monitor-1" }));
        await audit.record(touched("annotation.create", { annotationQueueId: "queue-1" }));
        await audit.record(touched("dataset.update", { datasetId: "ds-1" }));
        await audit.record(touched("workflow.update", { workflowId: "wf-1" }));

        const { status, body } = await readStrip(host, { projectId: PROJECT_ID });

        expect(status).toBe(200);
        expect(body).toMatchObject({
          result: {
            data: [
              { type: "workflow", id: "wf-1", name: "Flow", href: "/acme/studio/wf-1" },
              { type: "dataset", id: "ds-1", name: "Golden", href: "/acme/datasets/ds-1" },
              {
                type: "annotation",
                id: "queue-1",
                name: "Review",
                href: "/acme/annotations/review",
              },
              { type: "evaluation", id: "monitor-1", href: "/acme/online-evaluations" },
              { type: "prompt", id: "prompt-live", href: "/acme/prompts?prompt=prompt-live" },
            ],
          },
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "the home strip hides what is gone and never lists simulations" */
    /** @scenario "Excludes soft-deleted prompts from results" */
    /** @scenario "Excludes archived workflows from results" */
    it("drops deleted prompts, archived or missing workflows and simulations", async () => {
      const { runtime, host, audit } = await installed();

      try {
        await audit.record(touched("prompts.delete", { configId: "prompt-deleted" }));
        await audit.record(touched("workflow.archive", { workflowId: "wf-archived" }));
        await audit.record(touched("workflow.delete", { workflowId: "wf-gone" }));
        await audit.record(touched("scenarios.run", { scenarioSetId: "set-1" }));

        expect((await readStrip(host, { projectId: PROJECT_ID })).body).toEqual({
          result: { data: [] },
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "the home strip shows only the caller's own touches" */
    /** @scenario "Returns items from AuditLog filtered by user and project" */
    it("ignores what somebody else touched and what was touched in another project", async () => {
      const { runtime, host, audit } = await installed();

      try {
        await audit.record(touched("workflow.update", { workflowId: "wf-1" }, "someone-else"));
        await audit.record({
          ...touched("workflow.update", { workflowId: "wf-2" }),
          projectId: "another-project",
        });

        expect((await readStrip(host, { projectId: PROJECT_ID })).body).toEqual({
          result: { data: [] },
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
