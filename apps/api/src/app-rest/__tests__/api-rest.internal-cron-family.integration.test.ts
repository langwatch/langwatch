/**
 * @see specs/security/api-endpoint-authorization.feature
 * Enforcement is structural: `verifySecret` gates every route the family
 * registers, and each route is asserted on its own so an escapee fails here.
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  type ApiRestPorts,
} from "../api-rest.services.ts";
import { openTestRestDoors } from "./support/rest-doors.harness.ts";

const SECRET = "integration-internal-secret";

const CRON_ROUTES: { method: "GET" | "POST"; path: string }[] = [
  { method: "POST", path: "/api/cron/old_lambdas_cleanup" },
  { method: "GET", path: "/api/cron/old_lambdas_cleanup" },
];

describe("internal/service route authentication", () => {
  describe("when a cron route is called without credentials", () => {
    /** @scenario "A destructive cron route rejects callers without the secret" */
    it.each(CRON_ROUTES)(
      "rejects $method $path with no Authorization header",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas });

        const res = await api.fetch(path, { method });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when a cron route is called with the wrong secret", () => {
    it.each(CRON_ROUTES)(
      "rejects $method $path with a mismatched bearer token",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas });

        const res = await api.fetch(path, {
          method,
          headers: { authorization: "Bearer wrong" },
        });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when the deployment configured no cron secret", () => {
    it.each(CRON_ROUTES)(
      "refuses $method $path rather than falling open",
      async ({ method, path }) => {
        const cleanupOldLambdas = vi.fn(async () => {});
        const api = mount({ cleanupOldLambdas, secret: undefined });

        const res = await api.fetch(path, {
          method,
          headers: { authorization: "Bearer " },
        });

        expect(res.status).toBe(401);
        expect(cleanupOldLambdas).not.toHaveBeenCalled();
      },
    );
  });

  describe("when a cron route is called with the configured secret", () => {
    it.each(CRON_ROUTES)("runs the sweep for $method $path", async ({ method, path }) => {
      const cleanupOldLambdas = vi.fn(async () => {});
      const api = mount({ cleanupOldLambdas });

      const res = await api.fetch(path, {
        method,
        headers: { authorization: `Bearer ${SECRET}` },
      });

      expect(res.status).toBe(200);
      expect(cleanupOldLambdas).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a deployment that composed no cron collaborators", () => {
  it("does not mount the destructive door at all", () => {
    const hono = new Hono();
    for (const app of openTestRestDoors({
      services: {},
      ports: {
        handlerManagedCredential: async () => ({
          ok: true as const,
          project,
          resolved: { type: "legacyProjectKey" as const, project: project as never },
          markUsed: () => {},
        }),
        rateLimit: async () => ({ allowed: true }),
      } as ApiRestPorts,
    })) {
      hono.route("/", app);
    }

    expect(hono.routes.some((route) => route.path === "/api/cron/old_lambdas_cleanup")).toBe(false);
  });
});

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

function mount(options: { cleanupOldLambdas: () => Promise<void>; secret?: string | undefined }) {
  const hono = new Hono();
  for (const app of openTestRestDoors({
    services: {},
    ports: {
      handlerManagedCredential: async () => ({
        ok: true as const,
        project,
        resolved: { type: "legacyProjectKey" as const, project: project as never },
        markUsed: () => {},
      }),
      rateLimit: async () => ({ allowed: true }),
      cron: {
        internalSecret: () => ("secret" in options ? options.secret : SECRET),
        cleanupOldLambdas: options.cleanupOldLambdas,
      },
    } as ApiRestPorts,
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
