/**
 * Identity's commands reach the senders its own eventing modules hand over as the process
 * connects each pipeline (ARCHITECTURE.md §9): the App registers nothing itself.
 */
import { IDENTITY_PIPELINE_NAME, JOIN_REQUEST_PIPELINE_NAME } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { ConnectedIdentityEventing } from "../identity-composition.build.ts";

const IDENTITY_VERBS = [
  "attachIdentifier",
  "verifyIdentifier",
  "markPrimary",
  "detachIdentifier",
  "eraseUser",
  "proposeLink",
  "confirmLink",
  "rejectLink",
  "enrollMfa",
  "confirmMfa",
  "expireMfaEnrollment",
  "disableMfa",
  "consumeBackupCode",
  "regenerateBackupCodes",
  "recordMfaVerificationFailure",
];

function recordingCommands(pipeline: string, names: readonly string[]) {
  const sent: { pipeline: string; command: string; data: unknown }[] = [];
  const commands = Object.fromEntries(
    names.map((command) => [
      command,
      {
        send: async (data: unknown) => {
          sent.push({ pipeline, command, data });
        },
      },
    ]),
  );
  return { commands, sent };
}

describe("ConnectedIdentityEventing", () => {
  describe("given no pipeline has been connected yet", () => {
    /** @scenario "A command asked for before its pipeline is connected is not commandable" */
    it("answers null", async () => {
      const eventing = ConnectedIdentityEventing.create();

      await expect(
        eventing.tryPipelineCommand({ pipeline: IDENTITY_PIPELINE_NAME, command: "markPrimary" }),
      ).resolves.toBeNull();
    });
  });

  describe("given a connected pipeline is missing one of identity's verbs", () => {
    /** @scenario "A connected pipeline missing one of identity's verbs fails the install by name" */
    it("refuses naming the pipeline and the verb", () => {
      const eventing = ConnectedIdentityEventing.create();
      const { commands } = recordingCommands(JOIN_REQUEST_PIPELINE_NAME, ["approveJoin"]);

      expect(() => eventing.connect({ pipeline: JOIN_REQUEST_PIPELINE_NAME, commands })).toThrow(
        'The join-requests registration produced no "requestJoin" command sender',
      );
    });
  });

  describe("given the process connected the identity pipeline", () => {
    /** @scenario "Identity's commands reach the pipeline the process connected" */
    it("sends a verb through the connected pipeline's own sender", async () => {
      const eventing = ConnectedIdentityEventing.create();
      const { commands, sent } = recordingCommands(IDENTITY_PIPELINE_NAME, IDENTITY_VERBS);
      eventing.connect({ pipeline: IDENTITY_PIPELINE_NAME, commands });

      const sender = await eventing.tryPipelineCommand({
        pipeline: IDENTITY_PIPELINE_NAME,
        command: "markPrimary",
      });
      await sender?.send({ userId: "user_1" });

      expect(sent).toEqual([
        { pipeline: IDENTITY_PIPELINE_NAME, command: "markPrimary", data: { userId: "user_1" } },
      ]);
    });

    /** @scenario "A verb the module does not publish stays uncommandable" */
    it("answers null for a command outside identity's verb lists", async () => {
      const eventing = ConnectedIdentityEventing.create();
      const { commands } = recordingCommands(IDENTITY_PIPELINE_NAME, [
        ...IDENTITY_VERBS,
        "dropTable",
      ]);
      eventing.connect({ pipeline: IDENTITY_PIPELINE_NAME, commands });

      await expect(
        eventing.tryPipelineCommand({ pipeline: IDENTITY_PIPELINE_NAME, command: "dropTable" }),
      ).resolves.toBeNull();
    });
  });
});
