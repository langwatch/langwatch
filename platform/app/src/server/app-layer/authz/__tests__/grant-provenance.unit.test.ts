/**
 * A grant's PROVENANCE: which surface authored the fact, as distinct from
 * the actor who caused it. A SCIM reconciler and a join-request approval
 * both act as the platform, so the actor alone cannot tell "the directory
 * says so" from "the request was approved".
 *
 * This drives the real chain — GrantsService, over the ledger-backed
 * repository, over the writer — and asserts on the command the writer
 * actually emits, because a value that stops one layer short of the fact is
 * indistinguishable from one that never travelled at all.
 *
 * @see specs/rbac/authz-grants.feature
 */
import {
  type AuthzCollectorService,
  GrantsService,
} from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../epoch", () => ({
  bumpAuthzEpoch: vi.fn().mockResolvedValue(undefined),
}));

import type { PrismaClient } from "~/generated/prisma/client";
import { LedgerAuthzGrantsRepository } from "../repositories/authz-grants.ledger.repository";
import { harness, ORG_ID } from "./ledger-write-fork.harness";

const ADMIN = { userId: "user_admin" };

function service() {
  const { writer, db, sent } = harness({ onLedger: true });
  const repository = new LedgerAuthzGrantsRepository(
    db as unknown as PrismaClient,
    writer,
  );
  const grants = new GrantsService(repository, {
    newBindingId: () => "rb_provenance",
    bumpEpoch: vi.fn().mockResolvedValue(undefined),
    // Offboarding's proof only; no test here reaches it.
    collectorFor: () => ({}) as AuthzCollectorService,
  });
  return { grants, sent };
}

/** The `source` on each `attachGrant` command the writer emitted. */
function emittedSources(
  sent: Array<{ verb: string; data: unknown }>,
): unknown[] {
  return sent
    .filter(({ verb }) => verb === "attachGrant")
    .map(({ data }) => (data as { grant: { source: unknown } }).grant.source);
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

      expect(emittedSources(sent)).toEqual(["join-request"]);
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

      expect(emittedSources(sent)).toEqual(["grants-service"]);
    });
  });
});
