/**
 * @vitest-environment node
 * Legacy `/api/trace/*` routes mounted over real application. Tests that
 * all required members are read and refusals answer correctly.
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceLegacyCredentialService } from "../../services/trace-legacy-credential.service.ts";
import type { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import type { TraceService as TraceTreeService } from "../../services/trace.service.ts";
import { traceLegacyRest } from "../../transport/trace-legacy.rest.ts";
import {
  TraceApp,
  type TraceEditOverlayStore,
  type TraceSummaryReader,
  type TracesListReader,
  type TracesSessionGroupsReader,
  type TracesSpanReader,
} from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";
import { createTraceTestRequestBounds } from "./trace-bounds.fixture.ts";

const PROJECT = {
  id: "project-1",
  name: "Project One",
  slug: "project-one",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const LEGACY_PROJECT_KEY: ResolvedApiKeyCredential = {
  type: "legacyProjectKey",
  project: PROJECT,
};

/** The application as a process installs it, with fakes where storage would be. */
function bootTraceApp(options: {
  resolveToken: (token: string) => ResolvedApiKeyCredential | null;
}) {
  const findById = vi.fn(async () => void 0);
  const apiKeys = {
    findResolvedToken: vi.fn(async ({ token }: { token: string }) => options.resolveToken(token)),
    markUsed: vi.fn(),
  } as unknown as ApiKeyApi;
  const authz = {
    hasApiKeyPermission: vi.fn(async () => true),
  } as unknown as AuthzApi;

  const app = TraceApp.create({
    storedObjects: createApiFixture<StoredObjectApi>(),
    traces: {
      existence: { findExistingTraceIds: async ({ traceIds }) => [...traceIds] },
      read: { findById } as unknown as TraceLegacyRead,
      spans: {} as TracesSpanReader,
      summary: {} as TraceSummaryReader,
      list: {} as TracesListReader,
      sessionGroups: {} as TracesSessionGroupsReader,
      tree: {} as TraceTreeService,
      logRecords: { getLogsByTraceId: async () => [] },
      canonicalisation: {} as TraceCanonicalisationService,
      editOverlay: {} as TraceEditOverlayStore,
      changeTraceName: async () => void 0,
    },
    topics: {} as TopicApi,
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("no read in this suite subscribes");
      },
      cleanupTenantEmitter: () => void 0,
    },
    evaluations: {} as EvaluationApi,
    codingAgents: {} as CodingAgentApi,
    share: {} as ShareApi,
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    } as ProjectApi,
    requestBounds: createTraceTestRequestBounds(),
    exportBounds: null,
    protections: {
      resolveForApiKey: async () => ({ canSeeCosts: true }),
    } as unknown as TraceViewerProtectionService,
    legacyCredential: TraceLegacyCredentialService.create({ apiKeys, authz }),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The deprecated trace family resolves its own credential.");
      },
    },
  });

  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => app,
    credential: "public",
    onError: (_error, context) =>
      context.json({ error: "Internal Server Error", message: "An unknown error occurred" }, 500),
  });

  return { family, findById, apiKeys };
}

describe("given the deprecated trace family installed on the trace application", () => {
  describe("when a caller presents no credential", () => {
    /** @scenario "An anonymous legacy trace read is refused rather than failing" */
    it("answers 401 with the sentence the family publishes", async () => {
      const { family } = bootTraceApp({ resolveToken: () => null });

      const response = await family.request("/api/trace/trace-1");

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        message:
          "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).",
      });
    });
  });

  describe("when a caller presents a token nothing resolves", () => {
    /** @scenario "An anonymous legacy trace read is refused rather than failing" */
    it("answers 401 and says nothing about why", async () => {
      const { family } = bootTraceApp({ resolveToken: () => null });

      const response = await family.request("/api/trace/trace-1", {
        headers: { "x-auth-token": "not-a-key" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Invalid auth token." });
    });
  });

  describe("when a resolvable project key asks for a trace that is not there", () => {
    /** @scenario "A credentialled legacy trace read reaches the read" */
    it("reaches the read and answers the family's own 404", async () => {
      const { family, findById } = bootTraceApp({ resolveToken: () => LEGACY_PROJECT_KEY });

      const response = await family.request("/api/trace/trace-1", {
        headers: { "x-auth-token": "a-project-key" },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Trace not found." });
      expect(findById).toHaveBeenCalled();
    });
  });

  describe("when a resolvable project key posts a malformed search body", () => {
    /** @scenario "A malformed legacy search body earns the sentence the family writes" */
    it("parses the body with the family's own strict schema", async () => {
      const { family } = bootTraceApp({ resolveToken: () => LEGACY_PROJECT_KEY });

      const response = await family.request("/api/trace/search", {
        method: "POST",
        headers: { "x-auth-token": "a-project-key", "content-type": "application/json" },
        body: JSON.stringify({ startDate: "not-a-date", endDate: 1 }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("startDate");
    });
  });
});
