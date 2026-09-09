/**
 * @see specs/ops/back-office-http-door.feature
 * The back office's four console resources, driven through the real Hono app
 * the door registry opens, plus the operator list the door gates
 * on being the one the deployment configured.
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { resolvePersonDeploymentFacts } from "../../features/auth/auth.composition.ts";
import { resolveApiConfig } from "../../platform/config/api.config.ts";
import {
  type ApiRestPorts,
} from "../api-rest.services.ts";
import { openTestRestDoors } from "./support/rest-doors.harness.ts";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

/** The four the Backoffice console reads, at both addresses decision 20 gives them. */
const CONSOLE_RESOURCES = ["user", "organization", "project", "subscription"] as const;
const PREFIXES = ["/api/admin", "/api/v1/admin"] as const;

describe("given the deployment named its instance staff", () => {
  describe("when the host composing the process states no operator list", () => {
    /** @scenario "The deployment's operator list reaches the back office" */
    it("resolves the operator list from the deployment's own configuration", () => {
      const config = resolveApiConfig({ ADMIN_EMAILS: "staff@langwatch.test" });

      const facts = resolvePersonDeploymentFacts({
        supplied: undefined,
        adminEmails: config.deployment.adminEmails,
      });

      expect(facts.adminEmails).toBe("staff@langwatch.test");
    });

    it("leaves the list empty where the deployment named nobody", () => {
      const config = resolveApiConfig({});

      const facts = resolvePersonDeploymentFacts({
        supplied: undefined,
        adminEmails: config.deployment.adminEmails,
      });

      expect(facts.adminEmails).toBeUndefined();
    });
  });

  describe("when the host states an operator list of its own", () => {
    it("keeps the host's answer rather than the deployment's", () => {
      const facts = resolvePersonDeploymentFacts({
        supplied: { adminEmails: ["host@langwatch.test"] },
        adminEmails: "configured@langwatch.test",
      });

      expect(facts.adminEmails).toEqual(["host@langwatch.test"]);
    });
  });
});

describe("given a signed-in member of instance staff", () => {
  describe("when the console reads the resources it lists", () => {
    /** @scenario "Every back-office resource the console lists answers" */
    it.each(
      CONSOLE_RESOURCES.flatMap((resource) =>
        PREFIXES.map((prefix) => ({ resource, path: `${prefix}/${resource}` })),
      ),
    )("answers $path with the list the console renders", async ({ resource, path }) => {
      const adminOperation = vi.fn(async () => ({ data: [], total: 0 }));
      const api = mount({ adminOperation });

      const response = await api.fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource, method: "getList", params: {} }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [], total: 0 });
      expect(adminOperation).toHaveBeenCalledWith(
        expect.objectContaining({ resource, method: "getList", actorId: "staff-user" }),
      );
    });
  });
});

describe("given a signed-in person who is not instance staff", () => {
  describe("when they ask the back office for a resource", () => {
    /** @scenario "A signed-in person who is not staff cannot tell the door exists" */
    it.each(CONSOLE_RESOURCES)(
      "hides the %s resource rather than refusing it",
      async (resource) => {
        const adminOperation = vi.fn(async () => ({ data: [], total: 0 }));
        const api = mount({ adminOperation, isAdmin: () => false });

        const response = await api.fetch(`/api/admin/${resource}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resource, method: "getList", params: {} }),
        });

        expect(response.status).toBe(404);
        expect(adminOperation).not.toHaveBeenCalled();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mount(overrides: {
  adminOperation: () => Promise<{ data: unknown[]; total: number }>;
  isAdmin?: () => boolean;
}) {
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
      admin: {
        ops: () =>
          ({
            isAdmin: overrides.isAdmin ?? (() => true),
            operations: { adminOperation: overrides.adminOperation },
          }) as never,
        sessions: {
          resolveActor: async () => ({
            user: { id: "staff-user", email: "staff@langwatch.test" },
          }),
          resolveAuthSession: async () => ({ id: "session-1" }),
        },
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
