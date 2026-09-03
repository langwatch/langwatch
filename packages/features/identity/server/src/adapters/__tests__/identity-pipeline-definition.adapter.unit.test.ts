import {
  emptyIdentityHeads,
  type IdentifierFact,
  type IdentityHeads,
} from "@langwatch/identity-contract";
import { IdentityGuards } from "../../guards";
import type { IdentityHeadsRepository } from "../../identity-heads.repository";
import { describe, expect, it } from "vitest";
import { inMemoryIdentityReservations, inMemoryIdentityUsers } from "../../testing";
import { type Command, createTenantId, validateEventAggregateType } from "@langwatch/eventing";
import { AttachIdentifierCommand } from "../../intents/attach-identifier.intent";
import { DetachIdentifierCommand } from "../../intents/detach-identifier.intent";
import { EraseUserCommand } from "../../intents/erase-user.intent";
import { MarkPrimaryCommand } from "../../intents/mark-primary.intent";
import { VerifyIdentifierCommand } from "../../intents/verify-identifier.intent";
import { createIdentityPipeline } from "../identity-pipeline-definition.adapter";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

function fact(overrides: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_1",
    userId: USER,
    provider: "google",
    issuer: null,
    value: "sam.j@acme.com",
    domain: "acme.com",
    identifierHash: null,
    accountId: null,
    providerId: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

class HeadsOf implements IdentityHeadsRepository {
  constructor(private readonly heads: IdentityHeads) {}

  async findUserHashKey() {
    return "key_material";
  }

  async findHeads() {
    return this.heads;
  }

  async findActiveIdentifierByValue() {
    return null;
  }

  async findIdentifier({ identifierId }: { identifierId: string }) {
    return this.heads.identifiers[identifierId] ?? null;
  }

  async findIdentifierIdForAccount() {
    return null;
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

const held: IdentityHeads = {
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
 * own validator against the pipeline's declared type, so the envelope and
 * the pipeline cannot drift apart without this going red.
 */
describe("identity event aggregate type", () => {
  describe("when every verb emits", () => {
    /** @scenario "Every identity event rides the pipeline's declared aggregate type" */
    it.each([
      {
        label: "attach",
        handler: new AttachIdentifierCommand(
          new IdentityGuards(
            new HeadsOf(emptyIdentityHeads({ userId: USER })),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
        ),
        data: {
          ...base,
          commandId: "idcmd_1",
          accountId: null,
          provider: "google" as const,
          providerId: "google",
          issuer: "https://accounts.google.com",
          providerAccountId: "gid_9",
          value: "Sam.J@Acme.com",
          ceremony: { flow: "better-auth" },
        },
      },
      {
        label: "verify",
        handler: new VerifyIdentifierCommand(
          new IdentityGuards(
            new HeadsOf({
              userId: USER,
              identifiers: {
                idf_1: fact({ state: "ATTACHED", verifiedAtMs: null }),
              },
            }),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
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
        handler: new MarkPrimaryCommand(
          new IdentityGuards(
            new HeadsOf(held),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
        ),
        data: { ...base, commandId: "idcmd_3", identifierId: "idf_1" },
      },
      {
        label: "detach",
        handler: new DetachIdentifierCommand(
          new IdentityGuards(
            new HeadsOf(held),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
        ),
        data: { ...base, commandId: "idcmd_4", identifierId: "idf_2" },
      },
      {
        label: "erase",
        handler: new EraseUserCommand(
          new IdentityGuards(
            new HeadsOf(held),
            inMemoryIdentityUsers(),
            inMemoryIdentityReservations(),
          ),
        ),
        data: { ...base, commandId: "idcmd_5" },
      },
    ])("the store accepts every event $label emits", async ({ handler, data }) => {
      const declared = createIdentityPipeline({
        identityProjectionStore: {} as never,
        identityGuards: {} as never,
        mfaProjectionStore: {} as never,
        mfaGuards: {} as never,
      }).metadata.aggregateType;
      const events = await handler.handle(command(data) as never);

      expect(events.length).toBeGreaterThan(0);
      for (const [index, event] of events.entries()) {
        expect(() => validateEventAggregateType(event as never, declared, index)).not.toThrow();
      }
    });
  });

  describe("when the same command is retried", () => {
    /** @scenario "A retried command dedupes at the event store" */
    it("keys idempotency as commandId:index so a retry dedupes", async () => {
      const handler = new AttachIdentifierCommand(
        new IdentityGuards(
          new HeadsOf(emptyIdentityHeads({ userId: USER })),
          inMemoryIdentityUsers(),
          inMemoryIdentityReservations(),
        ),
      );
      const data = {
        ...base,
        commandId: "idcmd_1",
        accountId: null,
        provider: "google" as const,
        providerId: "google",
        issuer: "https://accounts.google.com",
        providerAccountId: "gid_9",
        value: "Sam.J@Acme.com",
        ceremony: { flow: "better-auth" },
      };
      const first = await handler.handle(command(data));
      const retry = await handler.handle(command(data));
      expect(first[0]!.idempotencyKey).toBe("idcmd_1:0");
      expect(retry[0]!.idempotencyKey).toBe("idcmd_1:0");
      expect(first[0]!.data).toEqual(retry[0]!.data);
    });
  });
});
