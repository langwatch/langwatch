/**
 * @vitest-environment node
 * A connection's history in words: never an internal event name, and an
 * attested domain never read as the customer's own proof (D05 amendment).
 * Corresponds to specs/identity/sso-connection-history.feature.
 */
import { describe, expect, it, vi } from "vitest";

import {
  SsoConnectionHistoryRepository,
  type SsoConnectionHistoryEntry,
} from "../../repositories/sso-connection-history.repository.ts";
import { SsoConnectionHistoryService } from "../sso-connection-history.service.ts";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";

function entry(
  overrides: Partial<SsoConnectionHistoryEntry> & { eventId: string },
): SsoConnectionHistoryEntry {
  return {
    type: "lw.identity.connection_registered",
    occurredAtMs: 1_700_000_000_000,
    source: "self-serve",
    domain: null,
    method: null,
    route: null,
    policy: null,
    name: null,
    note: null,
    replacesConnectionId: null,
    ...overrides,
  };
}

function serviceOver(entries: readonly SsoConnectionHistoryEntry[]) {
  const findHistory = vi
    .fn<SsoConnectionHistoryRepository["findHistory"]>()
    .mockResolvedValue(entries);
  class StubHistoryRepository extends SsoConnectionHistoryRepository {
    findHistory = findHistory;
  }
  return {
    service: SsoConnectionHistoryService.create({ history: new StubHistoryRepository() }),
    findHistory,
  };
}

describe("given an administrator reading a connection's history", () => {
  describe("when a fact this surface has words for is read", () => {
    /** @scenario "The words never leak an internal event name or a raw code" */
    it("reads as a sentence, never the event's own wire type", async () => {
      const { service } = serviceOver([
        entry({
          eventId: "evt_claimed",
          type: "lw.identity.domain_claimed",
          domain: "acme.com",
        }),
        entry({
          eventId: "evt_rejected",
          type: "lw.identity.domain_claim_rejected",
          domain: "acme.com",
          note: "the requester could not be reached at that domain",
        }),
      ]);

      const history = await service.getHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
      });

      for (const view of history) {
        expect(view.summary).not.toMatch(/lw\.identity\./);
      }
      expect(history[1]?.summary).toContain("acme.com");
      expect(history[1]?.summary).toContain("the requester could not be reached at that domain");
    });

    /** @scenario "A connection carried over from an earlier configuration says so" */
    it("marks a grandfathered fact as carried over, and a self-served one as not", async () => {
      const { service } = serviceOver([
        entry({ eventId: "evt_migrated", source: "legacy-grandfathered" }),
        entry({ eventId: "evt_self_served", source: "self-serve" }),
      ]);

      const history = await service.getHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
      });

      expect(history.find((view) => view.eventId === "evt_migrated")?.carriedOver).toBe(true);
      expect(history.find((view) => view.eventId === "evt_self_served")?.carriedOver).toBe(false);
    });
  });

  describe("when a domain was proved by a platform operator's attestation", () => {
    /** @scenario "An attested domain is never described as one the customer proved" */
    it("names the operator outright, never the customer's own proof", async () => {
      const { service } = serviceOver([
        entry({
          eventId: "evt_attested",
          type: "lw.identity.domain_attested",
          domain: "acme.com",
          method: "operator-attested",
        }),
      ]);

      const history = await service.getHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
      });

      const summary = history[0]?.summary ?? "";
      expect(summary).toContain("LangWatch operator");
      // Never worded as though "acme.com" itself did the proving.
      expect(summary).not.toMatch(/published record/i);
    });
  });

  describe("when the read is built", () => {
    /** @scenario "Another organization's connection history is not there to read" */
    it("passes exactly the organization and connection it was given, and nothing wider", async () => {
      const { service, findHistory } = serviceOver([]);

      await service.getHistory({ organizationId: ACME, connectionId: CONNECTION });

      expect(findHistory).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ACME, connectionId: CONNECTION }),
      );
    });
  });
});
