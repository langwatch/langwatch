/**
 * @vitest-environment node
 *
 * The identity log, read: the history panel's ordering and the proposal fold
 * the decision guards run on.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { describe, expect, it } from "vitest";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { EventLogIdentityRepository } from "../identity-event-log.repository";

const USER = "user_sam";
const T0 = 1_700_000_000_000;

function event({
  id,
  type,
  occurredAt,
  data,
}: {
  id: string;
  type: string;
  occurredAt: number;
  data: Record<string, unknown>;
}): IdentityEvent {
  return {
    id,
    type,
    occurredAt,
    aggregateId: USER,
    data,
  } as unknown as IdentityEvent;
}

function repositoryOver(events: IdentityEvent[]) {
  const store = {
    getEvents: async () => events,
  } as unknown as EventStore<IdentityEvent>;
  return new EventLogIdentityRepository({ eventStore: async () => store });
}

describe("given a person whose identity has a history", () => {
  const events = [
    event({
      id: "evt_1",
      type: "lw.identity.identifier_attached",
      occurredAt: T0,
      data: {
        identifierId: "idf_1",
        provider: "email",
        value: "sam@acme.com",
        domain: "acme.com",
        state: "ATTACHED",
        actor: { type: "system", id: null },
      },
    }),
    event({
      id: "evt_3",
      type: "lw.identity.identifier_detached",
      occurredAt: T0 + 2000,
      data: {
        identifierId: "idf_1",
        actor: { type: "user", id: "user_olive" },
      },
    }),
    event({
      id: "evt_2",
      type: "lw.identity.identifier_verified",
      occurredAt: T0 + 1000,
      data: {
        identifierId: "idf_1",
        verificationId: null,
        method: "email-link",
        actor: { type: "user", id: USER },
      },
    }),
  ];

  describe("when an operator opens them from the lookup", () => {
    /** @scenario "The most recent identity history is shown newest first" */
    it("lists the facts newest first, each with what happened, who caused it and when", async () => {
      const history = await repositoryOver(events).findHistory({
        userId: USER,
        limit: 10,
      });

      expect(history.map((entry) => entry.eventId)).toEqual([
        "evt_3",
        "evt_2",
        "evt_1",
      ]);
      expect(history[0]).toMatchObject({
        type: "lw.identity.identifier_detached",
        occurredAtMs: T0 + 2000,
        actor: { type: "user", id: "user_olive" },
      });
      // The one enum each fact turns on travels too, so the line reads as
      // prose rather than as a type name alone.
      expect(history[1]?.detail).toBe("email-link");
    });

    it("carries the address and no field a password, token or session could travel in", async () => {
      const history = await repositoryOver(events).findHistory({
        userId: USER,
        limit: 10,
      });

      const attached = history.find(
        (entry) => entry.type === "lw.identity.identifier_attached",
      );
      // Emails yes (ADR-101 §4) - the fact IS about one.
      expect(attached?.value).toBe("sam@acme.com");

      // And the projected shape has no room for anything else: the reader
      // never hands a raw payload through, so a future fact that carried a
      // secret could not leak one onto this screen.
      for (const entry of history) {
        expect(Object.keys(entry).sort()).toEqual([
          "actor",
          "connectionId",
          "detail",
          "domain",
          "eventId",
          "identifierId",
          "occurredAtMs",
          "proposalId",
          "provider",
          "type",
          "value",
        ]);
      }
    });
  });
});

describe("given a proposal and the decision somebody made on it", () => {
  describe("when the proposal is read back", () => {
    it("folds the decision onto the proposal it belongs to", async () => {
      const repository = repositoryOver([
        event({
          id: "evt_p",
          type: "lw.identity.link_proposed",
          occurredAt: T0,
          data: {
            proposalId: "prop_1",
            userId: USER,
            connectionId: "ssoc_acme",
            provider: "oidc",
            providerAccountId: "sub-1",
            value: "sam@acme.com",
            domain: "acme.com",
            reason: "unverified_orphan",
            actor: { type: "system", id: null },
          },
        }),
        event({
          id: "evt_d",
          type: "lw.identity.link_confirmed",
          occurredAt: T0 + 500,
          data: {
            proposalId: "prop_1",
            userId: USER,
            actor: { type: "user", id: "user_ash" },
          },
        }),
      ]);

      const proposal = await repository.findProposal({
        userId: USER,
        proposalId: "prop_1",
      });

      expect(proposal).toMatchObject({
        proposalId: "prop_1",
        reason: "unverified_orphan",
        decision: { outcome: "confirmed", byActorId: "user_ash" },
      });
    });

    it("leaves an undecided proposal undecided", async () => {
      const repository = repositoryOver([
        event({
          id: "evt_p",
          type: "lw.identity.link_proposed",
          occurredAt: T0,
          data: {
            proposalId: "prop_2",
            userId: USER,
            connectionId: null,
            provider: "oidc",
            providerAccountId: "sub-2",
            value: "sam@acme.com",
            domain: "acme.com",
            reason: "ambiguous_candidates",
            actor: { type: "system", id: null },
          },
        }),
      ]);

      const proposals = await repository.findProposals({ userId: USER });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.decision).toBeNull();
    });
  });
});
