/**
 * What the API process takes on when it composes AuthZ, and what it leaves to
 * the worker. Spec: packages/features/authz/specs/package-boundary.feature
 */
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import { PrismaConnection } from "@langwatch/prisma-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { Registry } from "prom-client";
import { describe, expect, it } from "vitest";
import { ApiAuthzComposition } from "../api-authz.composition.ts";
import { ApiEventingInfrastructure } from "../../platform/infrastructure/api-eventing.infrastructure.ts";

const AUTHZ_GRANT_PIPELINE = "authz_grant";

/** A client whose delegates exist and whose statements refuse: nothing here queries. */
function stubConnection(): PrismaConnection {
  const refuse = () => {
    throw new Error("Composing AuthZ must not query the database.");
  };
  const delegate = new Proxy({}, { get: () => refuse });
  const client = new Proxy({}, { get: () => delegate });
  return PrismaConnection.create({ client: client as never, pool: client as never });
}

function stubQueue(): { dependencies: GroupQueueDependencies<Record<string, unknown>> } {
  const redis = new Proxy({}, { get: () => async () => 0 });
  return { dependencies: { redis: redis as never } };
}

function eventing(resources: ResourceScope): ApiEventingInfrastructure {
  return ApiEventingInfrastructure.create({
    resources,
    queue: stubQueue(),
    processName: "langwatch-api-test",
  });
}

const config = {
  epochCacheEnabled: false,
  demoProjectId: undefined,
  demoProjectUserId: undefined,
} as const;

function compose(runtime: ApiEventingInfrastructure): ApiAuthzComposition {
  return ApiAuthzComposition.compose({
    database: stubConnection(),
    eventing: runtime,
    epoch: null,
    config,
    registry: new Registry(),
  });
}

describe("the API process's AuthZ responsibilities", () => {
  describe("when the application preset composes the AuthZ feature", () => {
    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("hands the request surfaces two contract-typed capabilities to receive", () => {
      const composed = compose(eventing(new ResourceScope()));

      // What a tRPC procedure, an API-key check or a SCIM sync is given: the
      // two capabilities, not the repositories, pipeline or cache under them.
      expect(typeof composed.permissions.hasPermission).toBe("function");
      expect(typeof composed.permissions.effectivePermissions).toBe("function");
      expect(typeof composed.permissions.tryResolveScope).toBe("function");
      expect(typeof composed.grants.attach).toBe("function");
      expect(typeof composed.grants.revoke).toBe("function");
      expect(typeof composed.grants.offboard).toBe("function");
    });

    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("installs the grants pipeline as a command producer with no event log to consume", async () => {
      const runtime = eventing(new ResourceScope());

      compose(runtime);

      expect(runtime.eventSourcing.getPipeline(AUTHZ_GRANT_PIPELINE)).toBeDefined();
      await expect(
        runtime.eventSourcing.eventStore!.storeEvents([], {} as never, "authz_grant" as never),
      ).rejects.toThrow(/does not consume them/i);
    });

    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("runs no subscriber or projection consumer for the grants it enqueues", () => {
      const runtime = eventing(new ResourceScope());

      compose(runtime);

      // A consumer half needs the process runtime; this one refuses to hand
      // one out, which is what keeps the fold and the audit subscriber on the
      // process that claims the shared queue.
      expect(() => runtime.eventSourcing.processRuntime).toThrow(/producer-only/i);
    });
  });
});
