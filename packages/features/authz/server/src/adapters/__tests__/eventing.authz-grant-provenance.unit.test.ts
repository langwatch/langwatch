/**
 * A grant's PROVENANCE, which is two facts rather than one.
 *
 * `source` is WHICH SURFACE authored it — a SCIM reconciler and a
 * join-request approval both act as the platform, so the actor alone cannot
 * tell "the directory says so" from "the request was approved". The ACTOR is
 * who caused it, and for those same two surfaces that is nobody: a system
 * principal from the closed registry, not a person.
 *
 * These drive the real chain — AuthzGrantsService, over the eventing-backed
 * grant repository, over the ledger writer — and assert on the command the
 * writer actually emits, because a value that stops one layer short of the
 * fact is indistinguishable from one that never travelled at all. That is why
 * this file is not folded into `authz-grants.service.unit.test.ts`: that suite
 * stubs both the repository and the ledger, so it pins provenance as far as
 * the port call and no further.
 *
 * @see specs/rbac/authz-grants.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StubAuthzEpoch } from "../../ports/__tests__/support/authz-epoch.stub";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { EventingAuthzGrantRepository } from "../../repositories/eventing/eventing.authz-grant.repository";
import { AuthzGrantsService } from "../../services/authz-grants.service";
import { ORG_ID, harness } from "./support/eventing.authz-ledger-fork.harness";

const ADMIN = { userId: "user_admin" };
const BINDING_ID = "rb_provenance";

function service() {
  const { writer, db, sent } = harness({ onLedger: true });
  const repository = EventingAuthzGrantRepository.create({
    database: db as never,
    writer,
    selectHead: async () => true,
  });
  const grants = AuthzGrantsService.create({
    repository,
    ledger: writer,
    epoch: new StubAuthzEpoch(),
    newBindingId: () => BINDING_ID,
    bindings: new StubAuthzBindingRepository(),
  });
  return { grants, db, sent };
}

type Sent = Array<{ verb: string; data: unknown }>;

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
      db.roleBinding.findFirst.mockResolvedValue({ id: BINDING_ID });
      // The fork harness carries the writes this file is about; the ownership
      // guard ahead of a revoke is the one read it does not already answer.
      Object.assign(db.roleBinding, {
        findUnique: vi.fn().mockResolvedValue({ id: BINDING_ID, organizationId: ORG_ID }),
      });

      await grants.revoke({
        actor: { type: "system", name: "scim" },
        bindingId: BINDING_ID,
        organizationId: ORG_ID,
      });

      expect(revokedActors(sent)).toEqual([{ type: "system", id: SYSTEM_ACTORS.scim }]);
    });
  });
});
