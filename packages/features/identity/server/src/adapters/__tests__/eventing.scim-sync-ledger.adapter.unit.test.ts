/**
 * The directory-sync ledger writer.
 *
 * Two properties, and they pull against each other on purpose: a directory's
 * push must never fail because its HISTORY could not be written, AND the loss
 * must be impossible to mistake for weather. So the writer stages, swallows,
 * and says at `error` exactly which registration is missing.
 */
import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  type ScimSyncCommand,
  type ScimSyncFactInput,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";
import { IdentityEventingPort } from "../../ports/identity-eventing.port";
import { ScimSyncLedgerWriter } from "../eventing.scim-sync-ledger.adapter";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_1";
const SYNC = "scimsync_1";
const ACTOR = { type: "system" as const, id: null };

class RecordingEventing extends IdentityEventingPort {
  readonly asked: Array<{ pipeline: string; command: string }> = [];
  readonly staged: unknown[] = [];

  constructor(private readonly registered: boolean) {
    super();
  }

  async tryPipelineCommand(input: { pipeline: string; command: string }) {
    this.asked.push(input);
    if (!this.registered) return null;
    return {
      send: async (data: unknown) => {
        this.staged.push(data);
        return undefined;
      },
    };
  }
}

function issueToken(): { command: ScimSyncCommand; facts: ScimSyncFactInput[] } {
  const data = {
    tenantId: ORGANIZATION,
    organizationId: ORGANIZATION,
    connectionId: CONNECTION,
    scimSyncId: SYNC,
    commandId: "cmd_1",
    occurredAtMs: 1_690_000_000_000,
    actor: ACTOR,
    tokenId: "tok_1",
  };
  return {
    command: { type: ISSUE_SCIM_TOKEN_COMMAND_TYPE, data },
    facts: [
      {
        type: SCIM_TOKEN_ISSUED_EVENT_TYPE,
        data: {
          scimSyncId: SYNC,
          connectionId: CONNECTION,
          organizationId: ORGANIZATION,
          tokenId: "tok_1",
          actor: ACTOR,
        },
      },
    ],
  };
}

describe("given a process that registered the directory-sync pipeline", () => {
  describe("when a push states a fact", () => {
    it("stages the command on the pipeline's own sender and appends nothing itself", async () => {
      const eventing = new RecordingEventing(true);
      const writer = new ScimSyncLedgerWriter({ eventing });
      const { command, facts } = issueToken();

      await writer.commit({ command, facts });

      expect(eventing.asked).toEqual([{ pipeline: "scim-sync", command: "issueScimToken" }]);
      expect(eventing.staged).toEqual([command.data]);
    });
  });

  describe("when the guard stated nothing", () => {
    it("stages nothing, because there is no fact to carry", async () => {
      const eventing = new RecordingEventing(true);
      const writer = new ScimSyncLedgerWriter({ eventing });
      const { command } = issueToken();

      await writer.commit({ command, facts: [] });

      expect(eventing.asked).toEqual([]);
    });
  });
});

describe("given a process that composed the writer but registered no directory-sync pipeline", () => {
  describe("when a push states a fact", () => {
    it("lets the push through rather than failing the identity provider", async () => {
      const writer = new ScimSyncLedgerWriter({ eventing: new RecordingEventing(false) });
      const { command, facts } = issueToken();

      await expect(writer.commit({ command, facts })).resolves.toBeUndefined();
    });

    it("records the loss at error, naming the pipeline and the sender that are missing", async () => {
      const logged: Array<[Record<string, unknown>, string]> = [];
      const writer = new ScimSyncLedgerWriter({ eventing: new RecordingEventing(false) });
      const { command, facts } = issueToken();

      // The writer's own module logger, which is where this line has to land:
      // a warn would read as an event-stack blip that clears, and this one
      // never does.
      const { createLogger } = await import("@langwatch/observability");
      const error = vi
        .spyOn(createLogger("langwatch:identity:scim-sync-ledger"), "error")
        .mockImplementation(((context: Record<string, unknown>, message: string) => {
          logged.push([context, message]);
        }) as never);

      await writer.commit({ command, facts });
      error.mockRestore();

      expect(logged).toHaveLength(1);
      expect(logged[0]?.[0]).toMatchObject({
        scimSyncId: SYNC,
        connectionId: CONNECTION,
        pipeline: "scim-sync",
        senderName: "issueScimToken",
      });
      expect(logged[0]?.[1]).toContain("scim-sync");
      expect(logged[0]?.[1]).toContain("issueScimToken");
    });

    it("names the verb the command carries, not one fixed sender", async () => {
      const eventing = new RecordingEventing(false);
      const writer = new ScimSyncLedgerWriter({ eventing });
      const { command, facts } = issueToken();

      await writer.commit({
        command: { ...command, type: RECORD_SCIM_USER_PUSH_COMMAND_TYPE } as ScimSyncCommand,
        facts,
      });

      expect(eventing.asked).toEqual([{ pipeline: "scim-sync", command: "recordScimUserPush" }]);
    });
  });
});
