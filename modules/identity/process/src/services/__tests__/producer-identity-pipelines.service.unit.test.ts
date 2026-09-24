import { createTenantId } from "@langwatch/eventing";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  MIGRATION_FINALIZED_EVENT_TYPE,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
/**
 * The four identity definitions, as a process that only SENDS on them builds them. What this pins
 * is the pair of properties a producer variant exists for.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { migrationFinalizedEventSchema } from "../../eventing/sso-connection-state.projection.ts";
import { PostgresIdentityPipelineAdapter } from "../../repositories/prisma/prisma.identity-pipeline.repository.ts";
import { PostgresScimSyncPipelineAdapter } from "../../repositories/prisma/prisma.scim-sync-pipeline.repository.ts";
import { IdentityProducerPipelinesAdapter } from "../producer-identity-pipelines.service.ts";

const PROCESS_NAME = "langwatch-api";

/** The command names a definition declares, in the order it declares them. */
function commandNamesOf(definition: {
  commands: readonly { definition: { name: string } }[];
}): string[] {
  return definition.commands.map((command) => command.definition.name);
}

const storeContext = { aggregateId: "aggregate_1", tenantId: createTenantId("org_1") };

describe("given a process that produces identity commands without consuming them", () => {
  describe("when it builds the four definitions", () => {
    it("names the pipelines the worker routes on", () => {
      expect(
        IdentityProducerPipelinesAdapter.create({
          processName: PROCESS_NAME,
        }).identityPipeline().metadata.name,
      ).toBe(IDENTITY_PIPELINE_NAME);
      expect(
        IdentityProducerPipelinesAdapter.create({
          processName: PROCESS_NAME,
        }).joinRequestPipeline().metadata.name,
      ).toBe(JOIN_REQUEST_PIPELINE_NAME);
      expect(
        IdentityProducerPipelinesAdapter.create({
          processName: PROCESS_NAME,
        }).ssoConnectionPipeline().metadata.name,
      ).toBe(SSO_CONNECTION_PIPELINE_NAME);
      expect(
        IdentityProducerPipelinesAdapter.create({
          processName: PROCESS_NAME,
        }).scimSyncPipeline().metadata.name,
      ).toBe(SCIM_SYNC_PIPELINE_NAME);
    });

    /**
     * The discriminator against a FORKED definition: a producer that declared only the commands it
     * sends would still register, still dispatch, and still stamp a routing triple — one the
     * worker's registry does not carry, so the queue would reject the job for redelivery forever.
     */
    it("declares the same commands the Postgres composition declares", () => {
      const producer = IdentityProducerPipelinesAdapter.create({
        processName: PROCESS_NAME,
      }).identityPipeline();
      const consumer = PostgresIdentityPipelineAdapter.create({
        database: {} as never,
      }).build();

      expect(commandNamesOf(producer as never)).toEqual(commandNamesOf(consumer as never));
      expect(producer.aggregate.type).toBe(consumer.aggregate.type);
    });

    /**
     * The same discriminator for `scim-sync`: the API resolves these five
     * names out of the registration at boot, so a producer declaring four of
     * them would fail the boot rather than lose the fifth verb's facts.
     */
    it("declares the directory-sync verbs the Postgres composition declares", () => {
      const producer = IdentityProducerPipelinesAdapter.create({
        processName: PROCESS_NAME,
      }).scimSyncPipeline();
      const consumer = PostgresScimSyncPipelineAdapter.create({
        database: {} as never,
      }).build();

      expect(commandNamesOf(producer as never)).toEqual([
        "issueScimToken",
        "recordScimUserPush",
        "recordScimGroupMapping",
        "recordScimApplyFailure",
        "redriveScimApply",
        "revokeScimSync",
      ]);
      expect(commandNamesOf(producer as never)).toEqual(commandNamesOf(consumer as never));
      expect(producer.aggregate.type).toBe(consumer.aggregate.type);
    });
  });

  describe("when something reaches a consumer-side dependency anyway", () => {
    it("refuses the projection read by name, saying which process reached it", async () => {
      const definition = IdentityProducerPipelinesAdapter.create({
        processName: PROCESS_NAME,
      }).joinRequestPipeline();
      const projection = [...(definition.stateProjections?.values() ?? [])][0];
      if (!projection)
        throw new Error("the join-request definition registered no state projection");

      await expect(
        projection.open((state) => state.store.get(storeContext.aggregateId, storeContext)),
      ).rejects.toThrow(/langwatch-api registered the join-requests pipeline as a producer only/);
    });

    it("refuses a guard's read by name rather than answering an empty head", async () => {
      const definition = IdentityProducerPipelinesAdapter.create({
        processName: PROCESS_NAME,
      }).ssoConnectionPipeline();
      const projection = [...(definition.stateProjections?.values() ?? [])][0];
      if (!projection) throw new Error("the connection definition registered no state projection");

      await expect(
        projection.open((state) => state.store.get(storeContext.aggregateId, storeContext)),
      ).rejects.toThrow(/langwatch-api registered the sso-connections pipeline as a producer only/);
    });

    /**
     * The directory-sync guard's read, which is the one a producer is most likely to reach by
     * accident: the SCIM boundary runs the SAME guards on the calling path, over the real Postgres
     * head, and only the STAGED re-run uses the definition's copy.
     */
    it("refuses the directory-sync head rather than answering an empty one", async () => {
      const definition = IdentityProducerPipelinesAdapter.create({
        processName: PROCESS_NAME,
      }).scimSyncPipeline();
      const projection = [...(definition.stateProjections?.values() ?? [])][0];
      if (!projection) throw new Error("the scim-sync definition registered no state projection");

      await expect(
        projection.open((state) => state.store.get(storeContext.aggregateId, storeContext)),
      ).rejects.toThrow(/langwatch-api registered the scim-sync pipeline as a producer only/);
    });

    it("refuses the directory move on a finished migration rather than dropping it", async () => {
      const subscriber = IdentityProducerPipelinesAdapter.create({ processName: PROCESS_NAME })
        .ssoConnectionPipeline()
        .eventSubscribers.get("scimDirectoryMove");
      const finalized = migrationFinalizedEventSchema.parse({
        id: "evt_1",
        aggregateId: "conn_new",
        aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
        tenantId: "org_1",
        createdAt: 1,
        occurredAt: 1,
        type: MIGRATION_FINALIZED_EVENT_TYPE,
        version: "2026-09-23",
        data: {
          connectionId: "conn_new",
          actor: { type: "user", id: "user_1" },
          source: "self-serve",
        },
      });

      await expect(
        subscriber?.handle(finalized, { tenantId: "org_1", aggregateId: "conn_new" }),
      ).rejects.toThrow(/langwatch-api registered the sso-connections pipeline as a producer only/);
    });
  });
});
