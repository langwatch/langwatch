import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import {
  type IdentityActor,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  PROPOSE_LINK_COMMAND_TYPE,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { identityEventsFor } from "../../eventing/identity-events.intent.ts";
import { MemoryIdentityHistoryRepository } from "../../repositories/memory/memory.identity-history.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import type { IdentityLedger } from "../../rules/identity-ledger.rules.ts";
import { LinkProposalGuardsService } from "../link-proposal-guards.service.ts";
import { LinkProposalService } from "../link-proposal.service.ts";

const SAM = "user_sam";
const OLIVE: IdentityActor = { type: "user", id: "user_olive" };
const OSCAR: IdentityActor = { type: "user", id: "user_oscar" };
const T0 = 1_756_000_000_000;

type LinkInput = Parameters<AuthApi["linkProviderAccount"]>[0];

let store: MemoryIdentityStore;
let commands: number;
let linked: LinkInput[];
let links: LinkProposalService;

/** Auth's account creation as the confirm path calls it, recording each link it made. */
function recordingAccounts(): Pick<AuthApi, "linkProviderAccount"> {
  return createApiFixture<Pick<AuthApi, "linkProviderAccount">>({
    linkProviderAccount: async (input) => {
      linked.push(input);
    },
  });
}

/** The ledger as the memory tier keeps it: the facts land on the store's log. */
function memoryLedger(): IdentityLedger {
  return {
    async commit({ command, facts }) {
      commands += 1;
      const events = identityEventsFor({ command, facts });
      store.identityEvents.push(...events);
      return events;
    },
  };
}

function propose({ proposalId }: { proposalId: string }): void {
  const command = {
    type: PROPOSE_LINK_COMMAND_TYPE,
    data: {
      tenantId: SAM,
      userId: SAM,
      commandId: `idcmd_${proposalId}`,
      proposalId,
      connectionId: "ssoc_1",
      provider: "oidc" as const,
      providerAccountId: "sub_sam",
      value: "sam@acme.com",
      reason: "ambiguous_candidates" as const,
      occurredAtMs: T0,
      actor: { type: "system" as const, id: null },
    },
  };
  store.identityEvents.push(
    ...identityEventsFor({
      command,
      facts: [
        {
          type: LINK_PROPOSED_EVENT_TYPE,
          data: {
            proposalId,
            userId: SAM,
            connectionId: "ssoc_1",
            provider: "oidc",
            providerAccountId: "sub_sam",
            value: "sam@acme.com",
            domain: "acme.com",
            reason: "ambiguous_candidates",
            actor: command.data.actor,
          },
        },
      ],
    }),
  );
}

function decision({ proposalId, actor }: { proposalId: string; actor: IdentityActor }) {
  return {
    tenantId: SAM,
    userId: SAM,
    commandId: `idcmd_decide_${proposalId}_${actor.id}`,
    proposalId,
    occurredAtMs: T0 + 1,
    actor,
  };
}

beforeEach(() => {
  store = MemoryIdentityStore.create();
  commands = 0;
  linked = [];
  const proposals = MemoryIdentityHistoryRepository.create(store);
  links = LinkProposalService.create({
    guards: LinkProposalGuardsService.create({ proposals }),
    ledger: memoryLedger(),
    proposals,
    accounts: recordingAccounts(),
  });
});

describe("LinkProposalService", () => {
  describe("given a sign-in waiting for somebody to decide it", () => {
    beforeEach(() => propose({ proposalId: "prop_1" }));

    describe("when olive rejects it", () => {
      it("states the rejection naming olive, and the proposal reads as decided", async () => {
        const facts = await links.rejectLink(decision({ proposalId: "prop_1", actor: OLIVE }));

        expect(facts.map((fact) => fact.type)).toEqual([LINK_REJECTED_EVENT_TYPE]);
        expect(facts[0]?.data).toEqual({ proposalId: "prop_1", userId: SAM, actor: OLIVE });
        const [proposal] = await MemoryIdentityHistoryRepository.create(store).findProposals({
          userId: SAM,
        });
        expect(proposal?.decision).toEqual({
          outcome: "rejected",
          byActorId: OLIVE.id,
          atMs: T0 + 1,
        });
      });
    });

    describe("when olive confirms it", () => {
      it("links the proposed account through auth, then states the confirmation naming olive", async () => {
        const facts = await links.confirmLink(decision({ proposalId: "prop_1", actor: OLIVE }));

        expect(linked).toEqual([
          {
            userId: SAM,
            connectionId: "ssoc_1",
            provider: "oidc",
            subject: "sub_sam",
            normalizedEmail: "sam@acme.com",
          },
        ]);
        expect(facts.map((fact) => fact.type)).toEqual([LINK_CONFIRMED_EVENT_TYPE]);
        expect(facts[0]?.data).toEqual({ proposalId: "prop_1", userId: SAM, actor: OLIVE });
        const [proposal] = await MemoryIdentityHistoryRepository.create(store).findProposals({
          userId: SAM,
        });
        expect(proposal?.decision?.outcome).toBe("confirmed");
      });
    });

    describe("when auth cannot make the link", () => {
      it("states nothing, so the proposal stays waiting for a retry", async () => {
        const proposals = MemoryIdentityHistoryRepository.create(store);
        const failing = LinkProposalService.create({
          guards: LinkProposalGuardsService.create({ proposals }),
          ledger: memoryLedger(),
          proposals,
          accounts: createApiFixture<Pick<AuthApi, "linkProviderAccount">>({
            linkProviderAccount: async () => {
              throw new Error("account create failed");
            },
          }),
        });

        await expect(
          failing.confirmLink(decision({ proposalId: "prop_1", actor: OLIVE })),
        ).rejects.toThrow("account create failed");

        expect(commands).toBe(0);
        const [proposal] = await proposals.findProposals({ userId: SAM });
        expect(proposal?.decision).toBeNull();
      });
    });
  });

  describe("given a proposal another operator already rejected", () => {
    beforeEach(async () => {
      propose({ proposalId: "prop_1" });
      await links.rejectLink(decision({ proposalId: "prop_1", actor: OSCAR }));
    });

    /** @scenario "A proposal somebody already decided cannot be decided twice" */
    it("refuses olive's decision, naming what was decided and by whom", async () => {
      for (const decide of [links.rejectLink.bind(links), links.confirmLink.bind(links)]) {
        await expect(
          decide(decision({ proposalId: "prop_1", actor: OLIVE })),
        ).rejects.toMatchObject({
          code: "identity_link_proposal_resolved",
          meta: { decidedOutcome: "rejected", decidedByActorId: OSCAR.id },
        });
      }
      expect(commands).toBe(1);
      expect(linked).toEqual([]);
    });
  });

  describe("given a proposal this person never had", () => {
    it("refuses with identity_link_proposal_not_found", async () => {
      await expect(
        links.rejectLink(decision({ proposalId: "prop_missing", actor: OLIVE })),
      ).rejects.toMatchObject({ code: "identity_link_proposal_not_found" });
    });
  });
});
