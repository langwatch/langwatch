/**
 * The reach of the two-class mapping, through the door table that mounts it.
 * `ApiRestHost` binds `canonicalErrorResponse` as every family's `onError`,
 * so two families (two doors) prove no family can hide a 422/400 split.
 */
import { publicRoute } from "@langwatch/api/access";
import { apiErrorSchema, defineRestRouter, projectRestFacts } from "@langwatch/api/rest";
import { moduleApi, type TransportPeers } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiRestHost } from "../../app-rest/api-rest.host.ts";

interface ProbeApi {
  read(): string;
}
const ProbeApi = moduleApi<ProbeApi>()("dataset");

const resolvedProjectKey = {
  type: "apiKey" as const,
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  project: { id: "project-1", slug: "probe-project", teamId: "team-1" },
};

/** The peer Apps a door reads, answering exactly what these tests need. */
function peers(): TransportPeers {
  const peer = {
    findResolvedToken: async () => resolvedProjectKey,
    resolveOrganizationToken: async () => ({ ok: false, reason: "not_found" }),
    markUsed: () => void 0,
    hasApiKeyPermission: async () => true,
    getApiKeyProjectDecision: async () => ({ outcome: "allowed" }),
    getSettings: async () => ({}),
    read: () => "probe",
  };

  return { app: (() => peer) as never, find: () => void 0 };
}

const app = () => ({ read: () => "probe" });

/** Family one: behind the project-key door, rejecting a body field. */
const projectFamily = defineRestRouter(ProbeApi)
  .withNamespace("probes")
  .withVersion("2026-08-07")
  .post("/", "createProbe")
  .withPermission("annotations:view")
  .withInput(z.object({ name: z.string().min(3) }))
  .withOutput(z.object({ ok: z.boolean() }))
  .withMiddleware(projectRestFacts)
  .handle(() => ({ ok: true }))
  .build()
  .router();

/** Family two: no door at all, rejecting a query parameter. */
const publicFamily = defineRestRouter(ProbeApi)
  .withNamespace("probe-public")
  .withVersion("2026-08-07")
  .get("/", "listProbes")
  .withAccess(publicRoute({ reason: "a fixture family that reads nothing and owns nothing" }))
  .withQuery(z.object({ limit: z.coerce.number().int().max(100) }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(() => ({ ok: true }))
  .build()
  .router();

function mount(family: typeof projectFamily | typeof publicFamily) {
  return ApiRestHost.create({ peers: peers(), config: {} }).mount(family, app);
}

const PROJECT_HEADERS = { "X-Auth-Token": "a-key", "Content-Type": "application/json" };

/**
 * The refusal a family answered, read through the canonical schema rather than
 * asserted into shape: a body that is not the envelope fails here rather than
 * passing an assertion on a field that was never there.
 */
async function refusalOf(response: Response): Promise<{
  code: string;
  meta?: Record<string, unknown>;
}> {
  return apiErrorSchema.parse(await response.json());
}

describe("given the families the api process mounts", () => {
  describe("when a request arrives intact and is rejected on its values", () => {
    /** @scenario "Both classes answer the same way on every family the process mounts" */
    it("answers 422 validation_error on the family behind the project-key door", async () => {
      const response = await mount(projectFamily).request("/api/probes/2026-08-07/", {
        method: "POST",
        headers: PROJECT_HEADERS,
        body: JSON.stringify({ name: "no" }),
      });

      expect(response.status).toBe(422);
      expect((await refusalOf(response)).code).toBe("validation_error");
    });

    /** @scenario "Both classes answer the same way on every family the process mounts" */
    it("answers 422 validation_error on the family behind no door at all", async () => {
      const response = await mount(publicFamily).request(
        "/api/probe-public/2026-08-07/?limit=9000",
      );

      expect(response.status).toBe(422);
      expect((await refusalOf(response)).code).toBe("validation_error");
    });

    /** @scenario "Both classes answer the same way on every family the process mounts" */
    it("names the offending field, so 422 is actionable and not just a number", async () => {
      const response = await mount(projectFamily).request("/api/probes/2026-08-07/", {
        method: "POST",
        headers: PROJECT_HEADERS,
        body: JSON.stringify({ name: "no" }),
      });

      expect((await refusalOf(response)).meta?.fields).toEqual(["name"]);
    });
  });

  describe("when a body cannot be read as a request at all", () => {
    /**
     * REGRESSION, not this file's to fix: `origin/main` answers 400
     * `malformed_request` for an unparseable body; the declared-router
     * runtime answers 500 instead — pins today's behaviour until fixed.
     */
    it("answers 500 today, because the declared-router runtime drops the guard", async () => {
      const response = await mount(projectFamily).request("/api/probes/2026-08-07/", {
        method: "POST",
        headers: PROJECT_HEADERS,
        body: "{ this is not json",
      });

      expect(response.status).toBe(500);
      expect((await refusalOf(response)).code).toBe("internal_error");
    });
  });
});
