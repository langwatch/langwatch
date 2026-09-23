/**
 * @vitest-environment node
 * Which process registers the four identity pipelines: two registration
 * shapes share the same names, and only one runtime holds one per name.
 * Spec: modules/identity/specs/identity-pipeline-registration-ownership.feature
 */
import type { EventSourcing } from "@langwatch/eventing";
import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SCIM_SYNC_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { buildIdentityInfrastructure } from "../identity-composition.build.ts";

/**
 * An `EventSourcing` that records what a composition asked of it, standing in
 * for the runtime the process owns. `getPipeline` throws before install,
 * exactly as the real one does, rather than answering emptily.
 */
function recordingRuntime() {
  const registered: string[] = [];
  const sent: { pipeline: string; command: string; data: unknown }[] = [];
  const installed = new Map<string, Record<string, unknown>>();
  const senderFor = (pipeline: string, name: string) => ({
    send: (data: unknown) => {
      sent.push({ pipeline, command: name, data });
      return Promise.resolve(null);
    },
  });
  const runtime = {
    isEnabled: true,
    register: (definition: { metadata: { name: string }; commands: { name: string }[] }) => {
      const pipeline = definition.metadata.name;
      registered.push(pipeline);
      return {
        commands: Object.fromEntries(
          definition.commands.map((command) => [command.name, senderFor(pipeline, command.name)]),
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
 * The database seam, unused here: every repository this build constructs
 * stores the client but no test makes a call. Typed off the build's own
 * parameter rather than naming `PrismaClient`, which belongs to the repository.
 */
type IdentityBuildInput = Parameters<typeof buildIdentityInfrastructure>[0];

function infrastructureFor(input: { eventing: EventSourcing; registersPipelines: boolean }) {
  return buildIdentityInfrastructure({
    prisma: {} as IdentityBuildInput["prisma"],
    eventing: input.eventing,
    adminEmails: [],
    registersPipelines: input.registersPipelines,
    engineProvider: undefined,
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

      expect([...runtime.registered].toSorted()).toEqual([...FOUR_PIPELINES].toSorted());
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
    let runtime: ReturnType<typeof recordingRuntime>;
    let infrastructure: ReturnType<typeof infrastructureFor>;

    beforeEach(() => {
      runtime = recordingRuntime();
      infrastructure = infrastructureFor({
        eventing: runtime.eventing,
        registersPipelines: false,
      });
      runtime.installProcessRegistration(IDENTITY_PIPELINE_NAME, ["attachIdentifier"]);
    });

    /** @scenario "Identity's commands reach the registration the process made" */
    it("answers each verb with a sender off the process's own registration", async () => {
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
        {
          pipeline: IDENTITY_PIPELINE_NAME,
          command: "attachIdentifier",
          data: { userId: "user-1" },
        },
        {
          pipeline: JOIN_REQUEST_PIPELINE_NAME,
          command: "approveJoin",
          data: { joinRequestId: "join-1" },
        },
      ]);
      expect(runtime.registered).toEqual([IDENTITY_PIPELINE_NAME, JOIN_REQUEST_PIPELINE_NAME]);
    });

    /** @scenario "A verb the module does not publish stays uncommandable" */
    it("answers null for a command outside identity's verb lists", async () => {
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
