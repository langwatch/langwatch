// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The directory-sync ledger writer. Two properties, and they pull against each other on purpose: a
 * directory's push must never fail because its HISTORY could not be written, AND the loss must be
 * impossible to mistake for weather.
 */
import {
  ISSUE_SCIM_TOKEN_COMMAND_TYPE,
  RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  type ScimSyncCommand,
  type ScimSyncFactInput,
} from "@langwatch/enterprise-scim-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  ScimSyncLedgerWriterService,
  type ScimSyncSenders,
} from "../eventing-scim-sync-ledger.service.ts";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_1";
const SYNC = "scimsync_1";
const ACTOR = { type: "system" as const, id: null };

/** Every verb's sender, each recording what it was handed under its own name. */
function recordingSenders(): { senders: ScimSyncSenders; staged: [string, unknown][] } {
  const staged: [string, unknown][] = [];
  const sender = (name: string) => ({
    send: async (data: unknown) => {
      staged.push([name, data]);
    },
  });
  return {
    staged,
    senders: {
      issueScimToken: sender("issueScimToken"),
      recordScimUserPush: sender("recordScimUserPush"),
      recordScimGroupMapping: sender("recordScimGroupMapping"),
      recordScimApplyFailure: sender("recordScimApplyFailure"),
      redriveScimApply: sender("redriveScimApply"),
      revokeScimSync: sender("revokeScimSync"),
    },
  };
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

function userPush(): ScimSyncCommand {
  return {
    type: RECORD_SCIM_USER_PUSH_COMMAND_TYPE,
    data: {
      tenantId: ORGANIZATION,
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      scimSyncId: SYNC,
      commandId: "cmd_2",
      occurredAtMs: 1_690_000_000_000,
      actor: ACTOR,
      userId: "user_1",
      externalId: "ext_1",
      op: "create",
    },
  };
}

describe("given a process that registered the directory-sync pipeline", () => {
  describe("when a push states a fact", () => {
    it("stages the command on the pipeline's own sender and appends nothing itself", async () => {
      const { senders, staged } = recordingSenders();
      const writer = ScimSyncLedgerWriterService.create();
      writer.connect(senders);
      const { command, facts } = issueToken();

      await writer.commit({ command, facts });

      expect(staged).toEqual([["issueScimToken", command.data]]);
    });
  });

  describe("when the guard stated nothing", () => {
    it("stages nothing, because there is no fact to carry", async () => {
      const { senders, staged } = recordingSenders();
      const writer = ScimSyncLedgerWriterService.create();
      writer.connect(senders);
      const { command } = issueToken();

      await writer.commit({ command, facts: [] });

      expect(staged).toEqual([]);
    });
  });
});

describe("given a process that composed the writer with no queue behind it", () => {
  describe("when a push states a fact", () => {
    it("lets the push through rather than failing the identity provider", async () => {
      const writer = ScimSyncLedgerWriterService.create();
      const { command, facts } = issueToken();

      await expect(writer.commit({ command, facts })).resolves.toBeUndefined();
    });

    it("records the loss at error, naming the pipeline and the sender that are missing", async () => {
      // The writer's own module logger, which is where this line has to land:
      // a warn would read as an event-stack blip that clears, and this one
      // never does.
      const { logger, lines } = createTestLogger();
      const writer = ScimSyncLedgerWriterService.create({ logger });
      const { command, facts } = issueToken();

      await writer.commit({ command, facts });

      const line = lines.findLine("error", "scim-sync");
      expect(line).toMatchObject({
        scimSyncId: SYNC,
        connectionId: CONNECTION,
        pipeline: "scim-sync",
        senderName: "issueScimToken",
      });
      expect(line?.msg).toContain("issueScimToken");
    });

    it("names the verb the command carries, not one fixed sender", async () => {
      const { logger, lines } = createTestLogger();
      const writer = ScimSyncLedgerWriterService.create({ logger });
      const { facts } = issueToken();

      await writer.commit({ command: userPush(), facts });

      expect(lines.findLine("error", "scim-sync")).toMatchObject({
        senderName: "recordScimUserPush",
      });
    });
  });
});
