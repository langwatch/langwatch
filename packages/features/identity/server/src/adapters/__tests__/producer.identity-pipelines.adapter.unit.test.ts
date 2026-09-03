/**
 * @vitest-environment node
 *
 * The four identity definitions, as a process that only SENDS on them builds
 * them.
 *
 * What this pins is the pair of properties a producer variant exists for. The
 * definition must be the SAME one the worker registers — same pipeline name,
 * same aggregate, same command names — because the routing triple every job
 * carries is derived from those, and two descriptions of one event stream drift
 * into jobs the worker cannot route. And every consumer-side stand-in must
 * REFUSE BY NAME rather than answer, because a fold store that silently
 * succeeded in a process that folds nothing would report a projection as
 * written when the row will never appear.
 */
import { describe, expect, it } from "vitest";
import {
  createIdentityProducerPipeline,
  createJoinRequestProducerPipeline,
  createScimSyncProducerPipeline,
  createSsoConnectionProducerPipeline,
} from "../producer.identity-pipelines.adapter";
import { PostgresIdentityPipelineAdapter } from "../postgres.identity-pipeline.adapter";
import { PostgresScimSyncPipelineAdapter } from "../postgres.scim-sync-pipeline.adapter";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

const PROCESS_NAME = "langwatch-api";

/** The command names a definition declares, in the order it declares them. */
function commandNamesOf(definition: { commands: ReadonlyArray<{ name: string }> }): string[] {
  return definition.commands.map((command) => command.name);
}

describe("given a process that produces identity commands without consuming them", () => {
  describe("when it builds the four definitions", () => {
    it("names the pipelines the worker routes on", () => {
      expect(
        (
          createIdentityProducerPipeline({ processName: PROCESS_NAME }) as unknown as {
            metadata: { name: string };
          }
        ).metadata.name,
      ).toBe(IDENTITY_PIPELINE_NAME);
      expect(
        (
          createJoinRequestProducerPipeline({ processName: PROCESS_NAME }) as unknown as {
            metadata: { name: string };
          }
        ).metadata.name,
      ).toBe(JOIN_REQUEST_PIPELINE_NAME);
      expect(
        (
          createSsoConnectionProducerPipeline({ processName: PROCESS_NAME }) as unknown as {
            metadata: { name: string };
          }
        ).metadata.name,
      ).toBe(SSO_CONNECTION_PIPELINE_NAME);
      expect(
        (
          createScimSyncProducerPipeline({ processName: PROCESS_NAME }) as unknown as {
            metadata: { name: string };
          }
        ).metadata.name,
      ).toBe(SCIM_SYNC_PIPELINE_NAME);
    });

    /**
     * The discriminator against a FORKED definition: a producer that declared
     * only the commands it sends would still register, still dispatch, and
     * still stamp a routing triple — one the worker's registry does not carry,
     * so the queue would reject the job for redelivery forever.
     */
    it("declares the same commands the Postgres composition declares", () => {
      const producer = createIdentityProducerPipeline({ processName: PROCESS_NAME });
      const consumer = PostgresIdentityPipelineAdapter.create({
        database: {} as never,
      }).build();

      expect(commandNamesOf(producer as never)).toEqual(commandNamesOf(consumer as never));
      expect((producer as unknown as { aggregate: { type: string } }).aggregate.type).toBe(
        (consumer as unknown as { aggregate: { type: string } }).aggregate.type,
      );
    });

    /**
     * The same discriminator for `scim-sync`, and the one that decides whether
     * an Enterprise directory's push has a history at all: the API resolves
     * these five names out of the registration at boot, so a producer
     * declaring four of them would fail the boot rather than lose the fifth
     * verb's facts in one provider's nightly run.
     */
    it("declares the directory-sync verbs the Postgres composition declares", () => {
      const producer = createScimSyncProducerPipeline({ processName: PROCESS_NAME });
      const consumer = PostgresScimSyncPipelineAdapter.create({
        database: {} as never,
      }).build();

      expect(commandNamesOf(producer as never)).toEqual([
        "issueScimToken",
        "recordScimUserPush",
        "recordScimGroupMapping",
        "recordScimApplyFailure",
        "revokeScimSync",
      ]);
      expect(commandNamesOf(producer as never)).toEqual(commandNamesOf(consumer as never));
      expect((producer as unknown as { aggregate: { type: string } }).aggregate.type).toBe(
        (consumer as unknown as { aggregate: { type: string } }).aggregate.type,
      );
    });
  });

  describe("when something reaches a consumer-side dependency anyway", () => {
    it("refuses the projection read by name, saying which process reached it", async () => {
      const definition = createJoinRequestProducerPipeline({
        processName: PROCESS_NAME,
      }) as unknown as {
        stateProjections: Map<string, { store: { tryLoad(): Promise<unknown> } }>;
      };
      const projection = [...definition.stateProjections.values()][0];
      if (!projection)
        throw new Error("the join-request definition registered no state projection");

      await expect(projection.store.tryLoad()).rejects.toThrow(
        /langwatch-api registered the join-requests pipeline as a producer only/,
      );
    });

    it("refuses a guard's read by name rather than answering an empty head", async () => {
      const definition = createSsoConnectionProducerPipeline({
        processName: PROCESS_NAME,
      }) as unknown as {
        stateProjections: Map<string, { store: { store(): Promise<unknown> } }>;
      };
      const projection = [...definition.stateProjections.values()][0];
      if (!projection) throw new Error("the connection definition registered no state projection");

      await expect(projection.store.store()).rejects.toThrow(
        /langwatch-api registered the sso-connections pipeline as a producer only/,
      );
    });

    /**
     * The directory-sync guard's read, which is the one a producer is most
     * likely to reach by accident: the SCIM boundary runs the SAME guards on
     * the calling path, over the real Postgres head, and only the STAGED
     * re-run uses the definition's copy. A stand-in that answered an empty
     * head here would state a fact the fold has already recorded.
     */
    it("refuses the directory-sync head rather than answering an empty one", async () => {
      const definition = createScimSyncProducerPipeline({
        processName: PROCESS_NAME,
      }) as unknown as {
        stateProjections: Map<string, { store: { tryLoad(): Promise<unknown> } }>;
      };
      const projection = [...definition.stateProjections.values()][0];
      if (!projection) throw new Error("the scim-sync definition registered no state projection");

      await expect(projection.store.tryLoad()).rejects.toThrow(
        /langwatch-api registered the scim-sync pipeline as a producer only/,
      );
    });
  });
});
