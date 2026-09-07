import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  type AttachIdentifierCommandData,
  type DetachIdentifierCommandData,
  type IdentifierFact,
  type IdentityFact,
  type MarkPrimaryCommandData,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import {
  type IdentityHeadsRepository,
  type IdentityVerificationRecord,
  type IdentityVerificationRepository,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import {
  type AccountIdentifierWrites,
  AccountIdentifiersService,
} from "../account-identifiers.service";

const USER_ID = "ana";
const NOW = 1_800_000_000_000;

class Heads implements IdentityHeadsRepository {
  readonly identifiers = new Map<string, IdentifierFact>();

  constructor(
    private readonly activeHolder: {
      userId: string;
      identifierId: string;
    } | null = null,
  ) {}

  async findUserHashKey() {
    return null;
  }

  async findHeads({ userId }: { userId: string }) {
    return {
      userId,
      identifiers: Object.fromEntries(this.identifiers),
    };
  }

  async hasFolded() {
    return true;
  }

  async findActiveIdentifierByValue() {
    return this.activeHolder;
  }

  async findIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }) {
    const identifier = this.identifiers.get(identifierId);
    return identifier?.userId === userId ? identifier : null;
  }

  async findIdentifierIdForAccount() {
    return null;
  }
}

class VerificationStore implements IdentityVerificationRepository {
  readonly records = new Map<string, IdentityVerificationRecord>();

  async replaceForIdentifier(record: IdentityVerificationRecord) {
    this.records.set(record.identifierId, record);
  }

  async findByIdentifierId({ identifierId }: { identifierId: string }) {
    return this.records.get(identifierId) ?? null;
  }

  async consume({
    identifierId,
    verificationId,
  }: {
    identifierId: string;
    verificationId: string;
  }) {
    const record = this.records.get(identifierId);
    if (record?.verificationId !== verificationId) {
      return false;
    }
    this.records.delete(identifierId);
    return true;
  }
}

const fixture = ({
  holder = null,
}: {
  holder?: { userId: string; identifierId: string } | null;
} = {}) => {
  const heads = new Heads(holder);
  const verificationStore = new VerificationStore();
  const attachedInputs: AttachIdentifierCommandData[] = [];
  const detachedInputs: DetachIdentifierCommandData[] = [];
  const primaryInputs: MarkPrimaryCommandData[] = [];
  const sent: Array<{ email: string; verificationUrl: string }> = [];

  const identity: AccountIdentifierWrites = {
    attachIdentifier: async (input) => {
      attachedInputs.push(input);
      const identifierId = `identifier-${attachedInputs.length}`;
      const value = normalizeIdentifierValue(input.value);
      const fact: IdentityFact = {
        type: IDENTIFIER_ATTACHED_EVENT_TYPE,
        occurredAt: input.occurredAtMs,
        data: {
          identifierId,
          userId: input.userId,
          accountId: input.accountId,
          provider: input.provider,
          providerId: input.providerId,
          issuer: input.issuer,
          providerAccountId: input.providerAccountId,
          value,
          identifierHash: null,
          domain: value.includes("@") ? (value.split("@")[1] ?? null) : null,
          connectionId: null,
          state: "ATTACHED",
          actor: input.actor,
        },
      };
      heads.identifiers.set(identifierId, {
        ...fact.data,
        verifiedAtMs: null,
        attachedAtMs: input.occurredAtMs,
        detachedAtMs: null,
      });
      return [fact];
    },
    detachIdentifier: async (input) => {
      detachedInputs.push(input);
      return [];
    },
    markPrimary: async (input) => {
      primaryInputs.push(input);
      return [];
    },
  };
  const ceremony = new VerificationCeremonyService(
    verificationStore,
    heads,
    { verifyIdentifier: async () => [] },
    { isLatched: async () => true, now: () => NOW },
  );
  const service = new AccountIdentifiersService({
    heads,
    identity,
    ceremony,
    deps: {
      sendConfirmation: async (message) => {
        sent.push(message);
      },
      buildConfirmationUrl: ({ identifierId, verificationId, token }) =>
        `https://example.com/confirm/${identifierId}/${verificationId}/${token}`,
      newCommandId: vi.fn(() => "command-add"),
      now: () => NOW,
    },
  });

  return { service, heads, attachedInputs, verificationStore, sent };
};

describe("AccountIdentifiersService.addEmailIdentifier", () => {
  /** @scenario "A newly added address is attached unverified, and only the ceremony verifies it" */
  it("attaches an inert email identifier before minting and mailing its proof", async () => {
    const subject = fixture();

    const added = await subject.service.addEmailIdentifier({
      userId: USER_ID,
      email: "Ana.New@Example.com",
      codeChallenge: "challenge-from-this-browser",
    });

    expect(subject.heads.identifiers.get(added.identifierId)).toMatchObject({
      provider: "email",
      value: "ana.new@example.com",
      state: "ATTACHED",
      verifiedAtMs: null,
    });
    expect(subject.attachedInputs).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        accountId: null,
        providerId: null,
        issuer: null,
        providerAccountId: null,
        ceremony: { flow: "settings-add-address" },
      }),
    ]);
    expect(subject.verificationStore.records.has(added.identifierId)).toBe(
      true,
    );
    expect(subject.sent).toEqual([
      expect.objectContaining({ email: "ana.new@example.com" }),
    ]);
  });

  /** @scenario "An address another account holds is not refused at the door" */
  it("still starts a proof ceremony when another account holds the address", async () => {
    const subject = fixture({
      holder: { userId: "olga", identifierId: "olga-primary" },
    });

    await expect(
      subject.service.addEmailIdentifier({
        userId: USER_ID,
        email: "held@example.com",
        codeChallenge: "challenge-from-this-browser",
      }),
    ).resolves.toMatchObject({ identifierId: "identifier-1" });

    expect(subject.attachedInputs).toHaveLength(1);
    expect(subject.verificationStore.records.has("identifier-1")).toBe(true);
    expect(subject.sent).toHaveLength(1);
  });
});
