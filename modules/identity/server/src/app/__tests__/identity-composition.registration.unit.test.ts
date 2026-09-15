/**
 * @vitest-environment node
 * Which process registers the four identity pipelines. Two registration shapes share the same
 * four names; one runtime holds one per name. The draining process composes Identity's read
 * graph before install, so it registers nothing here — registering the producer set too is what
 * killed the combined backend boot on `Pipeline "identity" is already registered`.
 * Spec: modules/identity/specs/identity-pipeline-registration-ownership.feature
 */
import type { EventSourcing } from "@langwatch/eventing";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import { buildIdentityInfrastructure } from "../identity-composition.build.ts";

/**
 * An `EventSourcing` that records what a composition asked of it, standing in
 * for the runtime the process owns. `getPipeline` answers only what has been
 * registered, exactly as the real one does - a lookup before the install phase
 * throws rather than answering emptily.
 */
function recordingRuntime() {
  const registered: string[] = [];
  const sent: Array<{ pipeline: string; command: string; data: unknown }> = [];
  const installed = new Map<string, Record<string, unknown>>();
  const senderFor = (pipeline: string, name: string) => ({
    send: (data: unknown) => {
      sent.push({ pipeline, command: name, data });
      return Promise.resolve(null);
    },
  });
  const runtime = {
    isEnabled: true,
    register: (definition: { metadata: { name: string }; commands: Array<{ name: string }> }) => {
      const pipeline = definition.metadata.name;
      registered.push(pipeline);
      return {
        commands: Object.fromEntries(
          definition.commands.map((command) => [
            command.name,
            senderFor(pipeline, command.name),
          ]),
        ),
      };
    },
    getPipeline: (name: string) => {
      const commands = installed.get(name);
      if (commands === undefined) {
        throw new Error(`Pipeline "${name}" not found. Available: ${registered.join(", ")}`);
      }
      return { commands };
    },
  };

  return {
    eventing: runtime as unknown as EventSourcing,
    registered,
    sent,
    /** The install phase, as far as a command sender can observe it. */
    installProcessRegistration: (pipeline: string, commandNames: readonly string[]) => {
      registered.push(pipeline);
      installed.set(
        pipeline,
        Object.fromEntries(commandNames.map((name) => [name, senderFor(pipeline, name)])),
      );
    },
  };
}

/**
 * The database seam, unused: every repository this build constructs stores the
 * client and touches it on a call, and no test here makes one. Typed off the
 * build's own parameter rather than by naming `PrismaClient`, which belongs to
 * the repository layer.
 */
type IdentityBuildInput = Parameters<typeof buildIdentityInfrastructure>[0];

function infrastructureFor(input: { eventing: EventSourcing; registersPipelines: boolean }) {
  return buildIdentityInfrastructure({
    prisma: {} as IdentityBuildInput["prisma"],
    eventing: input.eventing,
    config: { adminEmails: [], registersPipelines: input.registersPipelines },
  });
}

const FOUR_PIPELINES = [
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
];

describe("given a process in Identity's producer role", () => {
  describe("when it composes Identity", () => {
    /** @scenario "The producing process registers the four pipelines it stages commands on" */
    it("registers each of the four identity pipelines exactly once", () => {
      const runtime = recordingRuntime();

      infrastructureFor({ eventing: runtime.eventing, registersPipelines: true });

      expect([...runtime.registered].sort()).toEqual([...FOUR_PIPELINES].sort());
    });
  });
});

describe("given a process that drains the identity pipelines", () => {
  describe("when it composes Identity before its install phase", () => {
    /** @scenario "The draining process registers no second pipeline" */
    it("registers nothing", () => {
      const runtime = recordingRuntime();

      infrastructureFor({ eventing: runtime.eventing, registersPipelines: false });

      expect(runtime.registered).toEqual([]);
    });

    /** @scenario "A command asked for before the install phase names the missing registration" */
    it("refuses a command asked for before anything registered the pipeline", async () => {
      const runtime = recordingRuntime();
      const infrastructure = infrastructureFor({
        eventing: runtime.eventing,
        registersPipelines: false,
      });

      await expect(
        infrastructure.eventing.tryPipelineCommand({
          pipeline: IDENTITY_PIPELINE_NAME,
          command: "attachIdentifier",
        }),
      ).rejects.toThrow(/identity/);
    });
  });

  describe("when its install phase has registered the complete definitions", () => {
    /** @scenario "Identity's commands reach the registration the process made" */
    it("answers each verb with a sender off the process's own registration", async () => {
      const runtime = recordingRuntime();
      const infrastructure = infrastructureFor({
        eventing: runtime.eventing,
        registersPipelines: false,
      });
      runtime.installProcessRegistration(IDENTITY_PIPELINE_NAME, ["attachIdentifier"]);
      runtime.installProcessRegistration(JOIN_REQUEST_PIPELINE_NAME, ["approveJoin"]);

      const attach = await infrastructure.eventing.tryPipelineCommand({
        pipeline: IDENTITY_PIPELINE_NAME,
        command: "attachIdentifier",
      });
      const approve = await infrastructure.eventing.tryPipelineCommand({
        pipeline: JOIN_REQUEST_PIPELINE_NAME,
        command: "approveJoin",
      });
      await attach?.send({ userId: "user-1" });
      await approve?.send({ joinRequestId: "join-1" });

      expect(runtime.sent).toEqual([
        { pipeline: IDENTITY_PIPELINE_NAME, command: "attachIdentifier", data: { userId: "user-1" } },
        { pipeline: JOIN_REQUEST_PIPELINE_NAME, command: "approveJoin", data: { joinRequestId: "join-1" } },
      ]);
      expect(runtime.registered).toEqual([IDENTITY_PIPELINE_NAME, JOIN_REQUEST_PIPELINE_NAME]);
    });

    /** @scenario "A verb the module does not publish stays uncommandable" */
    it("answers null for a command outside identity's verb lists", async () => {
      const runtime = recordingRuntime();
      const infrastructure = infrastructureFor({
        eventing: runtime.eventing,
        registersPipelines: false,
      });
      runtime.installProcessRegistration(IDENTITY_PIPELINE_NAME, ["attachIdentifier"]);

      await expect(
        infrastructure.eventing.tryPipelineCommand({
          pipeline: IDENTITY_PIPELINE_NAME,
          command: "notAnIdentityVerb",
        }),
      ).resolves.toBeNull();
      await expect(
        infrastructure.eventing.tryPipelineCommand({
          pipeline: "some_other_pipeline",
          command: "attachIdentifier",
        }),
      ).resolves.toBeNull();
    });
  });
});
