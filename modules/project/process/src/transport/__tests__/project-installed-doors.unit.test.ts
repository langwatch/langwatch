import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { SessionReader } from "@langwatch/api/rest";
import { TrpcHost } from "@langwatch/api/trpc";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import type { ShareApi } from "@langwatch/share-contract";
/**
 * @vitest-environment node
 * @see specs/projects/projects-browser-door.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import type { Protections, TraceApi } from "@langwatch/trace-contract";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { projectProcessModule } from "../../project.module.ts";
import { projectTrpcTransport } from "../project.trpc.ts";

const ACTOR = { id: "user-1" };
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization-1";
const CREATED_AT = new Date("2026-09-01T00:00:00.000Z");
const CALLER_PROTECTIONS: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: "Admins",
  capturedOutputVisibleTo: null,
};

type Peers = Readonly<{
  auditLog: AuditLogApi;
  trace: TraceApi;
}>;

function recordingAuditLog(recorded: RecordAuditLogCommand[]): AuditLogApi {
  return createApiFixture<AuditLogApi>({
    record: async (command) => {
      recorded.push(command);
      return { id: "audit", occurredAt: 0 };
    },
  });
}

function installed(peers: Peers) {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(projectProcessModule)])
    .withConfig({ project: undefined })
    .withMembers({
      encryption: { encrypt: (plaintext: string) => `cipher(${plaintext})` },
    })
    .withObservability((observability) => observability.withLogging({ error: () => undefined }))
    .provide({
      organization: createApiFixture<OrganizationApi>({
        // A new team is created already staffed by its creator.
        createTeamWithMembers: async (input) => ({
          id: "team-new",
          name: input.name,
          slug: "new-team",
          organizationId: input.organizationId,
          isPersonal: false,
          ownerUserId: null,
          archivedAt: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        }),
      }),
      "api-key": createApiFixture<ApiKeyApi>({}),
      share: createApiFixture<ShareApi>({}),
      topic: createApiFixture<TopicApi>({}),
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      trace: peers.trace,
      "audit-log": peers.auditLog,
      "data-privacy": createApiFixture<DataPrivacyApi>({}),
    })
    .boot();
}

const PERMITTED = { permitted: true, organizationRole: null };

/** The process's own tRPC root, over what boot hands each of this module's mounts. */
async function doors(overrides: Partial<Peers> = {}) {
  const runtime = await installed({
    auditLog: overrides.auditLog ?? recordingAuditLog([]),
    trace:
      overrides.trace ??
      createApiFixture<TraceApi>({
        resolveViewerProtections: async (input) =>
          input.projectId === PROJECT_ID && input.userId === ACTOR.id ? CALLER_PROTECTIONS : {},
      }),
  });
  const provided = () => runtime.module(projectProcessModule).provided;
  const host = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: ACTOR.id }) }),
    authz: {
      getDecision: async () => PERMITTED,
      getProjectAnyDecision: async () => PERMITTED,
      checkScopeLineage: async () => ({ kind: "consistent" }),
    },
  });
  host.mount(projectTrpcTransport, provided);

  return { runtime, host };
}

/** One call over HTTP, through the same fetch adapter the api process serves tRPC with. */
async function call(
  host: TrpcHost,
  procedure: Readonly<{ path: string; type: "query" | "mutation"; input: unknown }>,
) {
  const encoded = encodeURIComponent(JSON.stringify(procedure.input));
  const request =
    procedure.type === "query"
      ? new Request(`http://api.test/api/trpc/${procedure.path}?input=${encoded}`)
      : new Request(`http://api.test/api/trpc/${procedure.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(procedure.input),
        });
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: host.router,
    createContext: () => host.context({ request }),
  });

  return { status: response.status, body: await response.json() };
}

describe("given the project module installed over memory repositories", () => {
  describe("when a project admin calls the removed key procedures", () => {
    /** @scenario The procedures that revealed or rotated the project key are gone */
    it.each(["project.getProjectAPIKey", "project.regenerateApiKey"])(
      "answers %s as a procedure that does not exist",
      async (path) => {
        const { runtime, host } = await doors();

        try {
          const answer = await call(host, {
            path,
            type: "mutation",
            input: { projectId: PROJECT_ID },
          });

          expect(answer.status).toBe(404);
        } finally {
          await runtime.stop();
        }
      },
    );
  });

  describe("when a project is created into a new team", () => {
    /** @scenario "creating a project answers with the new project's slug" */
    it("answers with the slug of the project it created", async () => {
      const { runtime, host } = await doors();

      try {
        expect(
          await call(host, {
            path: "project.create",
            type: "mutation",
            input: {
              organizationId: ORGANIZATION_ID,
              newTeamName: "New Team",
              name: "My Project",
              language: "python",
              framework: "openai",
            },
          }),
        ).toEqual({
          status: 200,
          body: {
            result: { data: { success: true, projectSlug: expect.stringMatching(/^my-project-/) } },
          },
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the field redaction status is read", () => {
    /** @scenario "the redaction status reads the caller's own protections" */
    it("answers with what the caller may see", async () => {
      const { runtime, host } = await doors();

      try {
        expect(
          await call(host, {
            path: "project.getFieldRedactionStatus",
            type: "query",
            input: { projectId: PROJECT_ID },
          }),
        ).toEqual({
          status: 200,
          body: {
            result: {
              data: {
                isRedacted: { input: true, output: false },
                visibleTo: { input: "Admins", output: null },
              },
            },
          },
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
