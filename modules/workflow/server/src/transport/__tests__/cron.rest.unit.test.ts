/**
 * @see specs/studio/nlp-lambda-cleanup.feature
 * The deployment's own housekeeping door, on a runtime that stands in for the
 * process: one shared-secret door, and the two literal addresses the running
 * CronJob already curls.
 */
// @vitest-environment node
import {
  createRestRuntime,
  type RestErrorHandler,
  type RestIdentity,
} from "@langwatch/api/rest";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { cronRest } from "../cron.rest.ts";

/** The bare envelope the process renders for anything the family did not answer. */
const renderRefusal: RestErrorHandler = (_error, c) => c.json({ error: "Internal" }, 500);

function mountCron(cleanupOldLambdas: () => Promise<void>) {
  // The deployment's own bearer is checked by the DOOR, ahead of any route, so
  // a caller reaching a handler here has already presented it.
  const sharedSecretDoor: RestIdentity = {
    authenticate: () => {
      throw new Error("The shared-secret door asks no permission of the bearer it admitted.");
    },
    // The door names WHICH deployment secret admitted the request, never its
    // value, so a door that admitted one is reviewable.
    identify: () => ({
      actor: null,
      scope: null,
      internal: { type: "internalSecret" as const, secretName: "CRON_API_KEY" },
    }),
  };
  const runtime = createRestRuntime({
    identity: sharedSecretDoor,
    doors: { internalSecret: sharedSecretDoor },
  });

  // No `credential` here: each route raises `internalSecret` for itself, which
  // is what the process's own shared-secret mount does.
  const hono = runtime.mount(cronRest.router(), {
    app: () => ({ cleanupOldLambdas }) as unknown as WorkflowApi,
    onError: renderRefusal,
  });

  return (method: "GET" | "POST") =>
    hono.fetch(new Request("http://api.test/api/cron/old_lambdas_cleanup", { method }));
}

describe("the studio's NLP Lambda sweep", () => {
  describe("given a deployment whose studio engines can be swept", () => {
    /** @scenario "A completed sweep answers the sentence the scheduler expects" */
    it("runs the sweep once and reports it succeeded", async () => {
      const cleanupOldLambdas = vi.fn(async () => {});

      const response = await mountCron(cleanupOldLambdas)("POST");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: "Old lambdas deleted successfully" });
      expect(cleanupOldLambdas).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The same sweep answers a scheduler that issues it as a GET" */
    it("answers a scheduler that reads the address instead of posting to it", async () => {
      const cleanupOldLambdas = vi.fn(async () => {});

      const response = await mountCron(cleanupOldLambdas)("GET");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: "Old lambdas deleted successfully" });
      expect(cleanupOldLambdas).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a deployment whose studio engines cannot be reached", () => {
    /** @scenario "A failed sweep answers the failure rather than a generic envelope" */
    it("answers the scheduler the failure it alerts on, not the process envelope", async () => {
      const response = await mountCron(async () => {
        throw new Error("no Lambda account composed");
      })("POST");

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        message: "Error deleting old lambdas",
        error: "no Lambda account composed",
      });
    });
  });

  describe("given the two addresses the running CronJob already curls", () => {
    it("keeps them literal, behind the deployment's own bearer, with no /api/v1 twin", () => {
      const declaration = cronRest.router();

      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
      const addresses: unknown[] = declaration.routes.map(
        (route: { method: string; path: string; credential?: string; access?: { kind: string } }) => [
          route.method,
          route.path,
          route.credential,
          route.access?.kind,
        ],
      );

      expect(addresses).toEqual([
        ["post", "/api/cron/old_lambdas_cleanup", "internalSecret", "authenticated"],
        ["get", "/api/cron/old_lambdas_cleanup", "internalSecret", "authenticated"],
      ]);
    });
  });
});
