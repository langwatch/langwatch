/**
 * @vitest-environment node
 * @see modules/audit-log/specs/audit-log.feature
 */
import { SessionReader } from "@langwatch/api/hosting";
import { TrpcHost } from "@langwatch/api/trpc";
import { AuditLogApi, type RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { auditLogProcessModule } from "../../audit-log.module.ts";
import { homeTrpcTransport } from "../home.trpc.ts";

const ACTOR = { id: "user-1" };
const PROJECT_ID = "project_1";
const PERMITTED = { permitted: true, organizationRole: null };

async function installed() {
  const runtime = await createApp({ role: "api" })
    .withModules([auditLogProcessModule])
    .withStores(memoryStores())
    .withConfig({ "audit-log": undefined })
    .boot();
  const host = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: ACTOR.id }) }),
    authz: {
      getDecision: async () => PERMITTED,
      getProjectAnyDecision: async () => PERMITTED,
      checkScopeLineage: async () => ({ kind: "consistent" }),
    },
  });
  host.mount(homeTrpcTransport, () => runtime.module(auditLogProcessModule).provided);

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
    /** @scenario "the home strip answers each touched entity once, newest first" */
    /** @scenario "Extracts prompt IDs from prompts.update actions" */
    /** @scenario "Extracts workflow IDs from workflow.update actions" */
    /** @scenario "Extracts dataset IDs from dataset.update actions" */
    it("answers each entity once, by id and type, at its newest touch", async () => {
      const { runtime, host, audit } = await installed();

      try {
        await audit.record(touched("workflow.create", { workflowId: "wf-1" }));
        await audit.record(touched("prompts.update", { configId: "prompt-1" }));
        await audit.record(touched("monitors.update", { checkId: "monitor-1" }));
        await audit.record(touched("annotation.create", { annotationQueueId: "queue-1" }));
        await audit.record(touched("dataset.update", { datasetId: "ds-1" }));
        await audit.record(touched("workflow.update", { workflowId: "wf-1" }));

        const { status, body } = await readStrip(host, { projectId: PROJECT_ID });

        expect(status).toBe(200);
        const touchedAt = expect.any(String);
        expect(body).toEqual({
          result: {
            data: [
              { type: "workflow", id: "wf-1", updatedAt: touchedAt },
              { type: "dataset", id: "ds-1", updatedAt: touchedAt },
              { type: "annotation", id: "queue-1", updatedAt: touchedAt },
              { type: "evaluation", id: "monitor-1", updatedAt: touchedAt },
              { type: "prompt", id: "prompt-1", updatedAt: touchedAt },
            ],
          },
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "the home strip never answers simulations" */
    it("answers the workflow and never the simulation", async () => {
      const { runtime, host, audit } = await installed();

      try {
        await audit.record(touched("workflow.update", { workflowId: "wf-1" }));
        await audit.record(touched("scenarios.run", { scenarioSetId: "set-1" }));

        const { body } = await readStrip(host, { projectId: PROJECT_ID });

        expect(body).toEqual({
          result: { data: [{ type: "workflow", id: "wf-1", updatedAt: expect.any(String) }] },
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
