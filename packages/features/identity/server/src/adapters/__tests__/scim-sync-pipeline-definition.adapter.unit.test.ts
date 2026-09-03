import {
  emptyScimSync,
  type ScimSyncState,
  scimSyncIdFor,
} from "@langwatch/identity-contract";
import { ScimSyncGuards } from "../../scim-sync-guards";
import { describe, expect, it } from "vitest";
import {
  type Command,
  createTenantId,
  validateEventAggregateType,
} from "@langwatch/eventing";
import {
  IssueScimTokenCommand,
  RecordScimApplyFailureCommand,
  RecordScimGroupMappingCommand,
  RecordScimUserPushCommand,
  RevokeScimSyncCommand,
} from "../../intents/scim-sync.intent";
import { createScimSyncPipeline } from "../scim-sync-pipeline-definition.adapter";

const ORGANIZATION = "org_acme";
const CONNECTION = "conn_okta_primary";
const SYNC = scimSyncIdFor({ connectionId: CONNECTION });
const T0 = 1_690_000_000_000;

function guardsOver(state: ScimSyncState | null) {
  return new ScimSyncGuards({ syncs: { findSync: async () => state } });
}

const syncing: ScimSyncState = {
  ...emptyScimSync({ scimSyncId: SYNC }),
  connectionId: CONNECTION,
  organizationId: ORGANIZATION,
  state: "SYNCING",
};

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(ORGANIZATION),
    aggregateId: SYNC,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

const base = {
  tenantId: ORGANIZATION,
  organizationId: ORGANIZATION,
  scimSyncId: SYNC,
  connectionId: CONNECTION,
  occurredAtMs: T0,
  actor: { type: "system" as const, id: "system:scim" },
};

/**
 * The aggregate type is the storage partition key, not a label: the event
 * store refuses at append any event whose type differs from the one its
 * pipeline declares (#7406). Every verb's event is run through the store's
 * own validator against the pipeline's declared type, so the envelope and
 * the pipeline cannot drift apart without this going red.
 */
describe("directory sync event aggregate type", () => {
  describe("when every verb emits", () => {
    it.each([
      {
        label: "issue token",
        handler: new IssueScimTokenCommand(guardsOver(null)),
        data: { ...base, commandId: "scimcmd_1", tokenId: "tok_1" },
      },
      {
        label: "record user push",
        handler: new RecordScimUserPushCommand(guardsOver(syncing)),
        data: {
          ...base,
          commandId: "scimcmd_2",
          userId: "user_sam",
          externalId: "u-1",
          op: "create" as const,
        },
      },
      {
        label: "record group mapping",
        handler: new RecordScimGroupMappingCommand(guardsOver(syncing)),
        data: {
          ...base,
          commandId: "scimcmd_3",
          groupId: "grp_1",
          externalId: "g-1",
        },
      },
      {
        label: "record apply failure",
        handler: new RecordScimApplyFailureCommand(guardsOver(syncing)),
        data: {
          ...base,
          commandId: "scimcmd_4",
          op: "deactivate_user" as const,
          errorCode: "offboard_incomplete",
          retryable: false,
          userId: "user_sam",
        },
      },
      {
        label: "revoke sync",
        handler: new RevokeScimSyncCommand(guardsOver(syncing)),
        data: {
          ...base,
          commandId: "scimcmd_5",
          tokenId: "tok_1",
          cause: "teardown" as const,
        },
      },
    ])("the store accepts every event $label emits", async ({
      handler,
      data,
    }) => {
      const declared = createScimSyncPipeline({
        scimSyncProjectionStore: {} as never,
        scimSyncGuards: {} as never,
      }).metadata.aggregateType;
      const events = await handler.handle(command(data) as never);

      expect(events.length).toBeGreaterThan(0);
      for (const [index, event] of events.entries()) {
        expect(() =>
          validateEventAggregateType(event as never, declared, index),
        ).not.toThrow();
      }
    });
  });

  describe("when the same command is retried", () => {
    it("keys idempotency as commandId:index so a retry dedupes", async () => {
      const handler = new RecordScimUserPushCommand(guardsOver(syncing));
      const data = {
        ...base,
        commandId: "scimcmd_2",
        userId: "user_sam",
        externalId: "u-1",
        op: "create" as const,
      };

      const first = await handler.handle(command(data));
      const retry = await handler.handle(command(data));

      expect(first[0]!.idempotencyKey).toBe("scimcmd_2:0");
      expect(retry[0]!.idempotencyKey).toBe("scimcmd_2:0");
      expect(first[0]!.data).toEqual(retry[0]!.data);
    });

    it("keys a failure and the retirement it lands with as separate indexes", async () => {
      const handler = new RecordScimApplyFailureCommand(guardsOver(syncing));
      const events = await handler.handle(
        command({
          ...base,
          commandId: "scimcmd_4",
          op: "deactivate_user" as const,
          errorCode: "offboard_incomplete",
          retryable: false,
          userId: "user_sam",
        }),
      );

      expect(events.map((event) => event.idempotencyKey)).toEqual([
        "scimcmd_4:0",
        "scimcmd_4:1",
      ]);
    });
  });

  describe("the pipeline's aggregate", () => {
    it("is the sync, so one connection's pushes never share a lane with another's", () => {
      expect(IssueScimTokenCommand.getAggregateId({ scimSyncId: SYNC })).toBe(
        SYNC,
      );
      expect(
        RecordScimUserPushCommand.getAggregateId({ scimSyncId: "other" }),
      ).toBe("other");
    });
  });

  describe("the command envelope's tenancy", () => {
    /**
     * A caller wiring the tenant apart from the organization would persist
     * events under one tenant's stream and fold them into another
     * organization's projection, which nothing downstream can detect. Refused
     * at the wire boundary instead.
     */
    it("refuses a command whose tenant is not its organization", () => {
      const refused = IssueScimTokenCommand.schema.validate({
        ...base,
        tenantId: "org_someone_else",
        commandId: "scimcmd_1",
        tokenId: "tok_1",
      });
      const accepted = IssueScimTokenCommand.schema.validate({
        ...base,
        commandId: "scimcmd_1",
        tokenId: "tok_1",
      });

      expect(refused.success).toBe(false);
      expect(accepted.success).toBe(true);
    });
  });
});
