import { IDENTITY_PIPELINE_NAME } from "@langwatch/identity-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
/**
 * The identity pipeline as the tasks runner builds it to send commands: the same definition the
 * worker drains, over the module's own rows (Alex, 2026-09-27).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { liveRepositories } from "../../__tests__/support/live-repositories.ts";
import { composeIdentityPipeline } from "../../eventing/user-identity.pipeline.ts";
import { IdentityProducerPipelines } from "../identity-producer-composition.build.ts";

/** The command names a definition declares, in the order it declares them. */
function commandNamesOf(definition: {
  commands: readonly { definition: { name: string } }[];
}): string[] {
  return definition.commands.map((command) => command.definition.name);
}

function producerPipeline() {
  return IdentityProducerPipelines.create({
    database: prismaDouble({}),
    eventing: { getEventStore: () => undefined },
  }).identityPipeline();
}

describe("given a process that sends identity commands without draining them", () => {
  describe("when it builds the identity definition", () => {
    it("names the pipeline the worker routes on", () => {
      expect(producerPipeline().metadata.name).toBe(IDENTITY_PIPELINE_NAME);
    });

    /**
     * A producer declaring a different command set would stamp routing the worker's registry does
     * not carry, so the queue would reject the job for redelivery forever.
     */
    it("declares the same commands the worker's composition declares", () => {
      const producer = producerPipeline();
      const consumer = composeIdentityPipeline({
        repositories: liveRepositories(prismaDouble({})),
      });

      expect(commandNamesOf(producer)).toEqual(commandNamesOf(consumer));
      expect(producer.aggregate.type).toBe(consumer.aggregate.type);
    });
  });
});
