import { describe, expect, it } from "vitest";
import { createTenantId } from "../../..";
import type { Command } from "../../../commands/command";
import { validateEventAggregateType } from "../../../stores/eventStoreUtils";
import {
  AttachIdentifierCommand,
  DetachIdentifierCommand,
  EraseUserCommand,
  type IdentityGuardReads,
  MarkPrimaryCommand,
  VerifyIdentifierCommand,
} from "../commands/identityCommands";
import { createIdentityPipeline } from "../pipeline";
import type {
  IdentifierFact,
  IdentityLedgerState,
} from "../projections/reduceIdentity";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

function fact(overrides: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_1",
    userId: USER,
    provider: "google",
    value: "sam.j@acme.com",
    domain: "acme.com",
    identifierHash: null,
    accountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

class StateReads implements IdentityGuardReads {
  constructor(private readonly state: IdentityLedgerState) {}

  async getUserHashKey() {
    return "key_material";
  }

  async findActiveIdentifierByValue() {
    return null;
  }

  async loadIdentityState() {
    return this.state;
  }
}

function command<T>(data: T): Command<T> {
  return {
    tenantId: createTenantId(USER),
    aggregateId: USER,
    type: "lw.identity.test",
    data,
  } as unknown as Command<T>;
}

const held: IdentityLedgerState = {
  userId: USER,
  identifiers: {
    idf_1: fact({ identifierId: "idf_1", state: "VERIFIED" }),
    idf_2: fact({ identifierId: "idf_2", state: "VERIFIED" }),
  },
};

const base = { tenantId: USER, userId: USER, occurredAtMs: T0, actor: ACTOR };

/**
 * The aggregate type is the storage partition key, not a label: the event
 * store refuses at append any event whose type differs from the one its
 * pipeline declares (#7406). Every verb's event is run through the store's
 * own validator against the pipeline's declared type, so a command and its
 * pipeline cannot drift apart without this going red.
 */
describe("identity event aggregate type", () => {
  describe("when every verb emits", () => {
    /** @scenario "Every identity event rides the pipeline's declared aggregate type" */
    it.each([
      {
        label: "attach",
        handler: new AttachIdentifierCommand(new StateReads(held)),
        data: {
          ...base,
          commandId: "idcmd_1",
          accountId: null,
          provider: "google" as const,
          providerAccountId: "gid_9",
          value: "Sam.J@Acme.com",
          ceremony: { flow: "better-auth" },
        },
      },
      {
        label: "verify",
        handler: new VerifyIdentifierCommand(
          new StateReads({
            userId: USER,
            identifiers: {
              idf_1: fact({ state: "ATTACHED", verifiedAtMs: null }),
            },
          }),
        ),
        data: {
          ...base,
          commandId: "idcmd_2",
          identifierId: "idf_1",
          verificationId: null,
          method: "creation" as const,
        },
      },
      {
        label: "mark primary",
        handler: new MarkPrimaryCommand(new StateReads(held)),
        data: { ...base, commandId: "idcmd_3", identifierId: "idf_1" },
      },
      {
        label: "detach",
        handler: new DetachIdentifierCommand(new StateReads(held)),
        data: { ...base, commandId: "idcmd_4", identifierId: "idf_2" },
      },
      {
        label: "erase",
        handler: new EraseUserCommand(new StateReads(held)),
        data: { ...base, commandId: "idcmd_5" },
      },
    ])("the store accepts every event $label emits", async ({
      handler,
      data,
    }) => {
      const declared = createIdentityPipeline({
        identityProjectionStore: {} as never,
        identityGuardReads: {} as never,
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
});
