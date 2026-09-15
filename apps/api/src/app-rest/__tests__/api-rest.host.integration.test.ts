/**
 * The process's own door table: which credential a declared family answers
 * behind, what each door resolves, and what a door this deployment configured
 * no secret for answers.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, projectRestFacts } from "@langwatch/api/rest";
import { moduleApi, type TransportPeers } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiRestHost } from "../api-rest.host.ts";

interface ProbeApi {
  read(): string;
}
const ProbeApi = moduleApi<ProbeApi>("dataset");

/** The peer Apps a door reads, answering exactly what these tests need. */
function peersWith(overrides: {
  resolved?: unknown;
  organization?: unknown;
  permitted?: boolean;
}): TransportPeers {
  const peer = {
    findResolvedToken: async () => overrides.resolved ?? null,
    resolveOrganizationToken: async () =>
      overrides.organization
        ? { ok: true, resolved: overrides.organization }
        : { ok: false, reason: "not_found" },
    markUsed: () => void 0,
    hasApiKeyPermission: async () => overrides.permitted ?? true,
    getApiKeyProjectDecision: async () => ({ outcome: "allowed" }),
    getSettings: async () => ({}),
    read: () => "probe",
  };

  return { app: (() => peer) as never, find: () => void 0 };
}

const projectFamily = defineRestRouter(ProbeApi)
  .withNamespace("probes")
  .withVersion("2026-08-07")
  .get("/", "listProbes")
  .withPermission("annotations:view")
  .withOutput(z.object({ slug: z.string(), actorId: z.string() }))
  .withMiddleware(projectRestFacts)
  .handle((_args, facts) => ({ slug: facts.projectSlug, actorId: facts.actorId }))
  .build()
  .router();

const internalFamily = defineRestRouter(ProbeApi)
  .withNamespace("probe-internal")
  .withVersion("2026-08-07")
  .withAddressing("literal", { v1Twin: false })
  .post("/api/probe-internal/sweep", "sweep")
  .withCredential("internalSecret")
  .withAccess(anyAuthenticated({ reason: "the deployment's own bearer is the whole gate" }))
  .withOutput(z.object({ swept: z.boolean() }))
  .handle(() => ({ swept: true }))
  .build()
  .router();

const resolvedProjectKey = {
  type: "apiKey" as const,
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  project: { id: "project-1", slug: "probe-project", teamId: "team-1" },
};

const app = () => ({ read: () => "probe" });

describe("given the process's own REST door table", () => {
  describe("when a project family is mounted on it", () => {
    it("resolves the key once and binds the facts the family declared", async () => {
      const host = ApiRestHost.create({ peers: peersWith({ resolved: resolvedProjectKey }), config: {} });
      const mounted = host.mount(projectFamily, app);

      const response = await mounted.request("/api/probes/2026-08-07/", {
        headers: { "X-Auth-Token": "a-key" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ slug: "probe-project", actorId: "user-1" });
    });

    it("refuses a request carrying no credential at all", async () => {
      const host = ApiRestHost.create({ peers: peersWith({}), config: {} });
      const mounted = host.mount(projectFamily, app);

      const response = await mounted.request("/api/probes/2026-08-07/");

      expect(response.status).toBe(401);
    });
  });

  describe("when a route raises the deployment's own bearer for itself", () => {
    it("admits the bearer this deployment configured for that family", async () => {
      const host = ApiRestHost.create({
        peers: peersWith({}),
        config: { internalSecrets: { "probe-internal": "the-secret" } },
      });
      const mounted = host.mount(internalFamily, app);

      const response = await mounted.request("/api/probe-internal/sweep", {
        method: "POST",
        headers: { authorization: "Bearer the-secret" },
      });

      expect(response.status).toBe(200);
    });

    it("refuses a bearer belonging to another family's door", async () => {
      const host = ApiRestHost.create({
        peers: peersWith({}),
        config: { internalSecrets: { "probe-internal": "the-secret", other: "another-secret" } },
      });
      const mounted = host.mount(internalFamily, app);

      const response = await mounted.request("/api/probe-internal/sweep", {
        method: "POST",
        headers: { authorization: "Bearer another-secret" },
      });

      expect(response.status).toBe(401);
    });

    it("answers not found where this deployment configured no such secret", async () => {
      const host = ApiRestHost.create({ peers: peersWith({}), config: {} });
      const mounted = host.mount(internalFamily, app);

      const response = await mounted.request("/api/probe-internal/sweep", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when the deployment composed no browser session verifier", () => {
    it("mounts the family all the same, so its addresses are the documented ones", () => {
      const host = ApiRestHost.create({ peers: peersWith({}), config: {} });

      expect(() => host.mount(projectFamily, app)).not.toThrow();
    });
  });
});
