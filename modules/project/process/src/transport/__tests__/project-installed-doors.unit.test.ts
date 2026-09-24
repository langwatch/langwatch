/**
 * @vitest-environment node
 * @see specs/projects/projects-browser-door.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { SessionReader } from "@langwatch/api/rest";
import { TrpcHost } from "@langwatch/api/trpc";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { LangyApi } from "@langwatch/langy-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { Protections, TraceApi } from "@langwatch/trace-contract";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import { projectServer } from "../../project.server.ts";
import { projectTrpcTransport } from "../project.trpc.ts";

const ACTOR = { id: "user-1" };
const PROJECT_ID = "project_1";
const ORGANIZATION_ID = "organization-1";
const ROTATED_KEY = "sk-lw-rotated";
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
  langy: LangyApi;
}>;

type LangyMint = Parameters<LangyApi["provisionVirtualKey"]>[0];

function recordingLangy(minted: LangyMint[]): LangyApi {
  return createApiFixture<LangyApi>({
    provisionVirtualKey: async (input) => {
      minted.push(input);
    },
  });
}

function recordingAuditLog(recorded: RecordAuditLogCommand[]): AuditLogApi {
  return createApiFixture<AuditLogApi>({
    record: async (command) => {
      recorded.push(command);
    },
  });
}

function installed(peers: Peers) {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(projectServer)])
    .withConfig({ project: undefined })
    .withMembers({
      encryption: { encrypt: (plaintext: string) => `cipher(${plaintext})` },
    })
    .withObservability((observability) => observability.withLogging({ error: () => undefined }))
    .provide({
      organization: createApiFixture<OrganizationApi>({
        createTeam: async (input) => ({
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
        addTeamMember: async () => undefined,
      }),
      "api-key": createApiFixture<ApiKeyApi>({
        regenerateLegacyProjectKey: async () => ROTATED_KEY,
      }),
      share: createApiFixture<ShareApi>({}),
      topic: createApiFixture<TopicApi>({}),
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      trace: peers.trace,
      "audit-log": peers.auditLog,
      langy: peers.langy,
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
    langy: overrides.langy ?? recordingLangy([]),
  });
  const provided = () => runtime.module(projectServer).provided;
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
  describe("when the base key is rotated", () => {
    /** @scenario "rotating the base key hands the new key back to the caller" */
    it("answers with the key the rotation minted and records the rotation", async () => {
      const recorded: RecordAuditLogCommand[] = [];
      const { runtime, host } = await doors({ auditLog: recordingAuditLog(recorded) });

      try {
        expect(
          await call(host, {
            path: "project.regenerateApiKey",
            type: "mutation",
            input: { projectId: PROJECT_ID },
          }),
        ).toEqual({ status: 200, body: { result: { data: { apiKey: ROTATED_KEY } } } });
        expect(recorded).toEqual([
          { action: "project.apiKey.regenerated", userId: ACTOR.id, projectId: PROJECT_ID },
        ]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the base key is rotated and the audit trail cannot be written", () => {
    /** @scenario "a failing audit trail does not withhold the rotated key" */
    it("still answers with the rotated key", async () => {
      const { runtime, host } = await doors({
        auditLog: createApiFixture<AuditLogApi>({
          record: async () => {
            throw new Error("audit store unreachable");
          },
        }),
      });

      try {
        expect(
          await call(host, {
            path: "project.regenerateApiKey",
            type: "mutation",
            input: { projectId: PROJECT_ID },
          }),
        ).toEqual({ status: 200, body: { result: { data: { apiKey: ROTATED_KEY } } } });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when a project is created into a new team", () => {
    /** @scenario "creating a project answers with the new project's slug" */
    it("answers with the slug of the project it created and mints its Langy key", async () => {
      const minted: LangyMint[] = [];
      const { runtime, host } = await doors({ langy: recordingLangy(minted) });

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
        expect(minted).toEqual([
          {
            projectId: expect.any(String),
            organizationId: ORGANIZATION_ID,
            actorUserId: ACTOR.id,
          },
        ]);
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
