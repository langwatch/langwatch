import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * Legacy `/api/trace/*` routes mounted over real application. Tests that
 * all required members are read and refusals answer correctly.
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceLegacyCredentialService } from "../../services/trace-legacy-credential.service.ts";
import { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import type { TraceService as TraceTreeService } from "../../services/trace.service.ts";
import { traceLegacyRest } from "../../transport/trace-legacy.rest.ts";
import { tracesRestCredential } from "../../transport/traces.rest.ts";
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
  const apiKeys = createApiFixture<ApiKeyApi>({
    findResolvedToken: vi.fn(async ({ token }: { token: string }) => options.resolveToken(token)),
    markUsed: vi.fn(),
  });
  const authz = createApiFixture<AuthzApi>({
    hasApiKeyPermission: vi.fn(async () => true),
  });
  const protections = TraceViewerProtectionService.create({
    authz,
    projects: createApiFixture<ProjectApi>({}, "projects"),
    plans: createApiFixture<PlanProvider>({}, "plans"),
    dataPrivacy: createApiFixture<DataPrivacyApi>({}, "data privacy"),
    fallbackVisibilityDays: 30,
    processName: "test",
  });
  vi.spyOn(protections, "resolveForApiKey").mockResolvedValue({ canSeeCosts: true });
  const unread = () => Promise.reject(new Error("this suite reads a trace only by id"));
  const read: TraceLegacyRead = {
    findById,
    getAllTracesForProject: unread,
    getTracesWithSpans: unread,
    getTracesByThreadId: unread,
    getTracesWithSpansByThreadIds: unread,
    getEvaluationsMultiple: unread,
    findEvaluationInputs: unread,
    getTopicCounts: unread,
    getCustomersAndLabels: unread,
    getDistinctFieldNames: unread,
    findSpanForPromptStudio: unread,
  };

  const app = TraceApp.create({
    storedObjects: createApiFixture<StoredObjectApi>(),
    traces: {
      existence: {
        findExistingTraceIds: async ({ traceIds }) => [...traceIds],
        countUsage: async () => ({ traces: 0, spans: 0 }),
      },
      read,
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
    protections,
    legacyCredential: TraceLegacyCredentialService.create({ apiKeys, authz }),
  });

  // The project door as the process opens it: absent and unresolvable keys are its refusals.
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request }) => {
        const token = request.headers.get("x-auth-token");
        if (!token) throw new ProjectMissingCredentialsError();
        if (!options.resolveToken(token)) throw new ProjectInvalidCredentialsError();

        return {
          actor: { type: "user" as const, id: "user-1" },
          scope: { tier: "project" as const, id: PROJECT.id },
        };
      },
    },
  });

  const family = runtime.mount(traceLegacyRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    facts: [bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: null }))],
  });

  return { family, findById, apiKeys };
}

describe("given the deprecated trace family installed on the trace application", () => {
  describe("when a caller presents no credential", () => {
    /** @scenario "An anonymous legacy trace read is refused rather than failing" */
    it("answers the project door's missing-credentials refusal", async () => {
      const { family, findById } = bootTraceApp({ resolveToken: () => null });

      const response = await family.request("/api/trace/trace-1");

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "missing_credentials" });
      expect(findById).not.toHaveBeenCalled();
    });
  });

  describe("when a caller presents a token nothing resolves", () => {
    /** @scenario "An anonymous legacy trace read is refused rather than failing" */
    it("answers the project door's invalid-credentials refusal", async () => {
      const { family } = bootTraceApp({ resolveToken: () => null });

      const response = await family.request("/api/trace/trace-1", {
        headers: { "x-auth-token": "not-a-key" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_credentials" });
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
