/**
 * Grant provenance: source (which surface) + actor (who caused it). Assert
 * on ledger writer emit to catch values that stop short of the fact.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub.ts";
import { StubAuthzEpoch } from "../../repositories/__tests__/support/authz-epoch.stub.ts";
import { EventingAuthzGrantRepository } from "../../repositories/eventing/eventing.authz-grant.repository.ts";
import { AuthzGrantsService } from "../../services/authz-grants.service.ts";
import { ORG_ID, harness, storedGrantRow } from "./support/eventing.authz-ledger-fork.harness.ts";

const ADMIN = { userId: "user_admin" };
const BINDING_ID = "rb_provenance";

function service() {
  const { writer, db, sent } = harness({});
  // The attach's read-your-writes hold reads the canonical Grant head; these
  // cases are about the fact the writer emits, not about the fold's lag.
  db.grant.count.mockResolvedValue(1);
  const repository = EventingAuthzGrantRepository.create({ database: db as never, writer });
  const grants = AuthzGrantsService.create({
    repository,
    ledger: writer,
    epoch: new StubAuthzEpoch(),
    newBindingId: () => BINDING_ID,
    bindings: new StubAuthzBindingRepository(),
  });
  return { grants, db, sent };
}

type Sent = { verb: string; data: unknown }[];

/** The `source` on each `attachGrant` command the writer emitted. */
function attachedSources(sent: Sent): unknown[] {
  return sent
    .filter(({ verb }) => verb === "attachGrant")
    .map(({ data }) => (data as { grant: { source: unknown } }).grant.source);
}

/** The `actor` on each `attachGrant` command the writer emitted. */
function attachedActors(sent: Sent): unknown[] {
  return sent
    .filter(({ verb }) => verb === "attachGrant")
    .map(({ data }) => (data as { grant: { actor: unknown } }).grant.actor);
}

/** The `actor` on each `revokeGrant` command the writer emitted. */
function revokedActors(sent: Sent): unknown[] {
  return sent
    .filter(({ verb }) => verb === "revokeGrant")
    .map(({ data }) => (data as { actor: unknown }).actor);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a grant attached through the grants service", () => {
  describe("when the caller states which surface authored it", () => {
    /** @scenario "A grant states which surface authored it" */
    /** @scenario "An authorization write emits a grant command" */
    it("carries that source on the emitted fact", async () => {
      const { grants, sent } = service();

      await grants.attach({
        actor: ADMIN,
        who: { type: "user", id: "user_alice" },
        role: { builtin: "MEMBER" },
        where: { type: "organization", id: ORG_ID },
        source: "join-request",
      });

      expect(attachedSources(sent)).toEqual(["join-request"]);
    });
  });

  describe("when the caller states no source", () => {
    /** @scenario "A grant nobody attributed is the grants service's own" */
    it("carries the grants service on the emitted fact", async () => {
      const { grants, sent } = service();

      await grants.attach({
        actor: ADMIN,
        who: { type: "user", id: "user_alice" },
        role: { builtin: "MEMBER" },
        where: { type: "organization", id: ORG_ID },
      });

      expect(attachedSources(sent)).toEqual(["grants-service"]);
    });
  });

  describe("when a surface rather than a person made it", () => {
    /** @scenario "A write with no person behind it names the surface that made it" */
    it("carries the registry's system principal on the emitted fact", async () => {
      const { grants, sent } = service();

      await grants.attach({
        actor: { type: "system", name: "joinRequests" },
        who: { type: "user", id: "user_alice" },
        role: { builtin: "MEMBER" },
        where: { type: "organization", id: ORG_ID },
        source: "join-request",
      });

      expect(attachedActors(sent)).toEqual([{ type: "system", id: SYSTEM_ACTORS.joinRequests }]);
      expect(attachedSources(sent)).toEqual(["join-request"]);
    });
  });

  describe("when a person made it", () => {
    /** @scenario "A write with no person behind it names the surface that made it" */
    it("still carries that person, from the raw id shape every boundary passes", async () => {
      const { grants, sent } = service();

      await grants.attach({
        actor: ADMIN,
        who: { type: "user", id: "user_alice" },
        role: { builtin: "MEMBER" },
        where: { type: "organization", id: ORG_ID },
      });

      expect(attachedActors(sent)).toEqual([{ type: "user", id: "user_admin" }]);
    });
  });
});

describe("given a grant revoked through the grants service", () => {
  describe("when a directory sync revokes it", () => {
    /** The revocation fact has no `source` field and needs none: the ACTOR
     *  already names the surface, and `reason` carries the rest. This is
     *  what makes D08's de-enroll attributable without touching the durable
     *  `grant_revoked` event.
     *  @scenario "A revocation names the surface that made it without a source of its own" */
    it("carries the surface as the emitted revocation's actor", async () => {
      const { grants, db, sent } = service();
      const row = storedGrantRow({
        id: BINDING_ID,
        principalId: "user_alice",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
      db.grant.findFirst.mockResolvedValue(row);
      db.grant.findMany.mockResolvedValue([row]);

      await grants.revoke({
        actor: { type: "system", name: "scim" },
        bindingId: BINDING_ID,
        organizationId: ORG_ID,
      });

      expect(revokedActors(sent)).toEqual([{ type: "system", id: SYSTEM_ACTORS.scim }]);
    });
  });
});
