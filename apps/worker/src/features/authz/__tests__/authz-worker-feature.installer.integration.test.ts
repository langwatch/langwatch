/**
 * The worker's half of the AuthZ split: the consumer graph the application
 * produces into. Spec: packages/features/authz/specs/package-boundary.feature
 */
import {
  type AuthzGrantPipelineDatabase,
  PostgresAuthzPipelineAdapter,
} from "@langwatch/authz-server";
import type { StaticPipelineDefinition } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import type { WorkerEventingRuntime } from "../../../platform/eventing/worker-eventing.runtime";
import { AuthzWorkerFeatureInstaller } from "../authz-worker-feature.installer";

type Registered = StaticPipelineDefinition<any, any, any>;

function eventingDouble() {
  const registered: Registered[] = [];
  const eventing = {
    eventSourcing: { register: (definition: Registered) => void registered.push(definition) },
  } as unknown as WorkerEventingRuntime;
  return { eventing, registered };
}

/** Delegates that exist and refuse: building the ledger reads them, never runs them. */
function refusingDatabase(): AuthzGrantPipelineDatabase {
  const refuse = () => {
    throw new Error("Building the grants ledger must not query the database.");
  };
  const delegate = new Proxy({}, { get: () => refuse });
  return new Proxy({}, { get: () => delegate }) as unknown as AuthzGrantPipelineDatabase;
}

function installer(eventing: WorkerEventingRuntime): AuthzWorkerFeatureInstaller {
  return AuthzWorkerFeatureInstaller.create({
    installer: {
      pipeline: PostgresAuthzPipelineAdapter.create({ database: refusingDatabase() }).build(),
    },
    eventing,
  });
}

describe("the worker's AuthZ responsibilities", () => {
  describe("when a worker-capable process installs the feature", () => {
    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("registers the same grants pipeline the application produces into", async () => {
      const { eventing, registered } = eventingDouble();

      await installer(eventing).install();

      expect(registered.map((definition) => definition.metadata.name)).toEqual(["authz_grant"]);
      expect(registered[0]!.commands.map((command) => command.name)).toEqual([
        "attachGrant",
        "changeGrantRole",
        "revokeGrant",
        "defineRole",
        "changeRolePermissions",
        "deleteRole",
      ]);
    });

    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("carries the projection and audit subscriber consumers the application does not run", async () => {
      const { eventing, registered } = eventingDouble();

      await installer(eventing).install();

      expect([...registered[0]!.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
      expect([...registered[0]!.eventSubscribers.keys()]).toEqual(["auditTrail"]);
    });

    /** @scenario "Each process installs only its AuthZ responsibilities" */
    it("registers one producer for the aggregate however often it is installed", async () => {
      const { eventing, registered } = eventingDouble();
      const feature = installer(eventing);

      await feature.install();
      await feature.install();

      expect(registered).toHaveLength(1);
    });
  });
});
