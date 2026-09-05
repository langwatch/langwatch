/**
 * Deciding a waiting sign-in (ADR-117 §3, D05).
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import type { IdentityLedger } from "../identity-ledger";
import { LinkProposalGuards } from "../link-proposal-guards";
import type {
  LinkProposalReadsRepository,
  LinkProposalRecord,
} from "../link-proposal.repository";
import {
  type LinkProposalDirectoryPort,
  LinkProposalService,
} from "../link-proposal.service";

const OPERATOR = { type: "user" as const, id: "user_olive" };

function aProposal(
  overrides: Partial<LinkProposalRecord> = {},
): LinkProposalRecord {
  return {
    proposalId: "prop_1",
    userId: "user_sam",
    connectionId: "ssoc_acme",
    provider: "oidc",
    providerAccountId: "idp-subject-1",
    value: "sam@acme.com",
    domain: "acme.com",
    reason: "unverified_orphan",
    proposedAtMs: 1_700_000_000_000,
    decision: null,
    ...overrides,
  };
}

class InMemoryProposals implements LinkProposalReadsRepository {
  constructor(private readonly proposals: LinkProposalRecord[]) {}

  async findProposal({
    userId,
    proposalId,
  }: {
    userId: string;
    proposalId: string;
  }): Promise<LinkProposalRecord | null> {
    return (
      this.proposals.find(
        (proposal) =>
          proposal.userId === userId && proposal.proposalId === proposalId,
      ) ?? null
    );
  }

  async findProposals({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LinkProposalRecord[]> {
    return this.proposals.filter((proposal) => proposal.userId === userId);
  }
}

class RecordingLedger implements IdentityLedger {
  readonly commits: { command: IdentityCommand; facts: IdentityFactInput[] }[] =
    [];

  async commit({
    command,
    facts,
  }: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): Promise<IdentityFact[]> {
    this.commits.push({ command, facts });
    return facts.map((fact) => ({ ...fact, occurredAt: 1 }) as IdentityFact);
  }
}

class RecordingDirectory implements LinkProposalDirectoryPort {
  readonly links: {
    userId: string;
    provider: string;
    subject: string;
    normalizedEmail: string;
  }[] = [];

  async linkProviderAccount(input: {
    userId: string;
    connectionId: string | null;
    provider: string;
    subject: string;
    normalizedEmail: string;
  }): Promise<void> {
    this.links.push({
      userId: input.userId,
      provider: input.provider,
      subject: input.subject,
      normalizedEmail: input.normalizedEmail,
    });
  }
}

function build(proposals: LinkProposalRecord[]) {
  const reads = new InMemoryProposals(proposals);
  const ledger = new RecordingLedger();
  const directory = new RecordingDirectory();
  const service = new LinkProposalService({
    guards: new LinkProposalGuards({ proposals: reads }),
    ledger,
    proposals: reads,
    directory,
  });
  return { service, ledger, directory };
}

const command = {
  tenantId: "user_sam",
  userId: "user_sam",
  commandId: "cmd_1",
  occurredAtMs: 1_700_000_100_000,
  actor: OPERATOR,
};

describe("given a sign-in waiting for somebody to confirm it", () => {
  describe("when an operator confirms it", () => {
    /** @scenario "Confirming a proposed sign-in attaches the method and lets the person in" */
    it("links the account through the ordinary ceremony and records who confirmed", async () => {
      const { service, ledger, directory } = build([aProposal()]);

      await service.confirmLink({ ...command, proposalId: "prop_1" });

      // The link is made by asking the directory to create the provider
      // account - better-auth's own write, which fires the attach ceremony.
      // Nothing here attaches an identifier itself.
      expect(directory.links).toEqual([
        {
          userId: "user_sam",
          provider: "oidc",
          subject: "idp-subject-1",
          normalizedEmail: "sam@acme.com",
        },
      ]);

      // And the fact carries the operator, not the person signing in.
      const commit = ledger.commits[0];
      expect(commit?.command.type).toBe("lw.identity.confirm_link");
      expect(commit?.facts).toEqual([
        {
          type: "lw.identity.link_confirmed",
          data: {
            proposalId: "prop_1",
            userId: "user_sam",
            actor: OPERATOR,
          },
        },
      ]);
    });
  });

  describe("when an operator rejects it", () => {
    /** @scenario "Rejecting a proposed sign-in records the decision and changes nothing else" */
    it("records the rejection and attaches nothing", async () => {
      const { service, ledger, directory } = build([aProposal()]);

      await service.rejectLink({ ...command, proposalId: "prop_1" });

      const commit = ledger.commits[0];
      expect(commit?.command.type).toBe("lw.identity.reject_link");
      expect(commit?.facts).toEqual([
        {
          type: "lw.identity.link_rejected",
          data: {
            proposalId: "prop_1",
            userId: "user_sam",
            actor: OPERATOR,
          },
        },
      ]);

      // Nothing was linked, so the person keeps every method they held and
      // gains none.
      expect(directory.links).toEqual([]);
    });
  });
});

describe("given a proposal another operator already decided", () => {
  describe("when a second operator decides it", () => {
    /** @scenario "A proposal somebody already decided cannot be decided twice" */
    it("refuses with the resolved code and names the decision", async () => {
      const { service, ledger, directory } = build([
        aProposal({
          decision: {
            outcome: "confirmed",
            byActorId: "user_ash",
            atMs: 1_700_000_050_000,
          },
        }),
      ]);

      // The code, never the message: the words are copy and will change.
      await expect(
        service.confirmLink({ ...command, proposalId: "prop_1" }),
      ).rejects.toMatchObject({
        code: "identity_link_proposal_resolved",
        meta: { decidedOutcome: "confirmed", decidedByActorId: "user_ash" },
      });

      // Rejecting it a second way is refused the same way.
      await expect(
        service.rejectLink({ ...command, proposalId: "prop_1" }),
      ).rejects.toMatchObject({ code: "identity_link_proposal_resolved" });

      expect(ledger.commits).toEqual([]);
      expect(directory.links).toEqual([]);
    });
  });
});

describe("given a proposal that does not exist", () => {
  describe("when an operator decides it", () => {
    it("refuses by name rather than stating a fact about nothing", async () => {
      const { service, ledger } = build([]);

      await expect(
        service.confirmLink({ ...command, proposalId: "prop_gone" }),
      ).rejects.toMatchObject({ code: "identity_link_proposal_not_found" });
      expect(ledger.commits).toEqual([]);
    });
  });
});
