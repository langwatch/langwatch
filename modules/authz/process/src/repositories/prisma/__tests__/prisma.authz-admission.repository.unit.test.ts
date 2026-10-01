/**
 * @vitest-environment node
 * The admission reads and the two clearances against a stated database: the
 * marker is only read off a membership that can still be signed into, and the
 * completion carries its whole precondition in the statement it sends.
 */
import { describe, expect, it, vi } from "vitest";

import {
  PrismaAuthzAdmissionRepository,
  type PrismaAuthzAdmissionDatabase,
} from "../prisma.authz-admission.repository.ts";

const ORGANIZATION_ID = "org_admission";
const USER_ID = "user_admission";
const GRANT_ID = "rb_admission";
const SCOPE = { organizationId: ORGANIZATION_ID, userId: USER_ID };

type MembershipFindFirst = PrismaAuthzAdmissionDatabase["organizationUser"]["findFirst"];
type GrantFindFirst = PrismaAuthzAdmissionDatabase["grant"]["findFirst"];
type MembershipRow = Awaited<ReturnType<MembershipFindFirst>>;
type GrantRow = Awaited<ReturnType<GrantFindFirst>>;

function harness(rows: { membership?: MembershipRow; grant?: GrantRow; updated?: number } = {}) {
  const membershipFindFirst = vi.fn(
    async (_args: Parameters<MembershipFindFirst>[0]) => rows.membership ?? null,
  );
  const grantFindFirst = vi.fn(async (_args: Parameters<GrantFindFirst>[0]) => rows.grant ?? null);
  const executeRaw = vi.fn(
    async (_query: TemplateStringsArray, ..._values: unknown[]) => rows.updated ?? 0,
  );
  const database: PrismaAuthzAdmissionDatabase = {
    organizationUser: { findFirst: membershipFindFirst },
    grant: { findFirst: grantFindFirst },
    $executeRaw: executeRaw,
  };

  return {
    membershipFindFirst,
    grantFindFirst,
    executeRaw,
    repository: PrismaAuthzAdmissionRepository.create({ database }),
  };
}

describe("the admission marker read", () => {
  it("asks only for a live membership carrying an intent", async () => {
    const { repository, membershipFindFirst } = harness();

    await repository.readAdmissionMarker(SCOPE);

    expect(membershipFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        disabledAt: null,
        user: { deactivatedAt: null },
        pendingSsoGrantId: { not: null },
      },
    });
  });

  it("answers absent when no membership carries one", async () => {
    const { repository } = harness();

    await expect(repository.readAdmissionMarker(SCOPE)).resolves.toEqual({ found: false });
  });

  it("answers the intent and the membership's business time", async () => {
    const { repository } = harness({
      membership: { pendingSsoGrantId: GRANT_ID, createdAt: new Date(1_700_000_000_000) },
    });

    await expect(repository.readAdmissionMarker(SCOPE)).resolves.toEqual({
      found: true,
      grantId: GRANT_ID,
      occurredAtMs: 1_700_000_000_000,
    });
  });
});

describe("the admission grant read", () => {
  it("names the organization-scoped USER grant the marker claimed", async () => {
    const { repository, grantFindFirst } = harness();

    await repository.readAdmissionGrant({ ...SCOPE, grantId: GRANT_ID });

    expect(grantFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: GRANT_ID,
        organizationId: ORGANIZATION_ID,
        principalType: "USER",
        principalId: USER_ID,
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION_ID,
      },
    });
  });

  it("reports a grant the ledger took back as revoked", async () => {
    const { repository } = harness({ grant: { revokedAt: new Date(1) } });

    await expect(repository.readAdmissionGrant({ ...SCOPE, grantId: GRANT_ID })).resolves.toEqual({
      found: true,
      revoked: true,
    });
  });
});

describe("clearing an admission", () => {
  it("completes only when exactly one membership row matched the precondition", async () => {
    const matched = harness({ updated: 1 });
    const missed = harness({ updated: 0 });

    await expect(
      matched.repository.completeAdmission({ ...SCOPE, grantId: GRANT_ID }),
    ).resolves.toBe(true);
    await expect(
      missed.repository.completeAdmission({ ...SCOPE, grantId: GRANT_ID }),
    ).resolves.toBe(false);
  });

  it("sends the person, the organization and the intent as bound values", async () => {
    const { repository, executeRaw } = harness({ updated: 1 });

    await repository.completeAdmission({ ...SCOPE, grantId: GRANT_ID });

    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([USER_ID, ORGANIZATION_ID, GRANT_ID]);
  });

  it("clears a revoked marker without asking the ledger anything", async () => {
    const { repository, executeRaw, grantFindFirst } = harness({ updated: 1 });

    await expect(repository.clearPendingAdmission({ ...SCOPE, grantId: GRANT_ID })).resolves.toBe(
      true,
    );
    expect(grantFindFirst).not.toHaveBeenCalled();
    expect(executeRaw.mock.calls[0]?.slice(1)).toEqual([USER_ID, ORGANIZATION_ID, GRANT_ID]);
  });
});
