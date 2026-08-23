/**
 * ADR-110 — an organization created after the migration never migrates.
 *
 * The migration carries EXISTING access across, and a new organization has
 * none. What matters here is not only THAT the status row is written but
 * WHEN: the gate is what every authorization write forks on, so the row has
 * to land before the founder's grants, or the organization's first access is
 * written as legacy rows by a tenant that claims to be on the engine.
 *
 * @see specs/migration/authz-grants-rollout.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * A transaction that records the order of what it was asked to write, so an
 * ordering claim is checked rather than asserted in a comment. Every model
 * used by the creation paths answers with the shape those paths read back.
 */
function recordingPrisma() {
  const calls: string[] = [];
  // The argument is declared even though the recorder ignores it: without it
  // the mock types as zero-arity, and reading `.mock.calls[0][0]` — which is
  // how the report assertion below reaches what was written — is a type
  // error on an empty tuple.
  const record = (name: string, result: unknown) =>
    vi.fn(async (_args: unknown) => {
      calls.push(name);
      return result;
    });

  const tx = {
    organization: {
      create: record("organization.create", { id: "org_new", name: "Acme" }),
      findUnique: vi.fn(async () => null),
    },
    systemMigrationTenantState: {
      create: record("systemMigrationTenantState.create", {}),
    },
    systemMigrationEnrollment: {
      create: record("systemMigrationEnrollment.create", {}),
    },
    organizationUser: { create: record("organizationUser.create", {}) },
    team: {
      create: record("team.create", {
        id: "team_new",
        slug: "acme",
        name: "Acme",
      }),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;

  return { prisma, tx, calls };
}

function writerSpy() {
  const attachBindings = vi.fn(async () => {
    return { attached: [], duplicates: [] };
  });
  return {
    writer: { attachBindings } as unknown as GrantsLedgerWriter,
    attachBindings,
  };
}

const CREATE_INPUT = {
  orgId: "org_new",
  orgName: "Acme",
  orgSlug: "acme",
  teamId: "team_new",
  teamSlug: "acme",
  userId: "user_founder",
  phoneNumber: null,
  signUpData: undefined,
  primaryIntent: null,
  pricingModel: undefined,
} as never;

describe("given an organization is created after the authz migration", () => {
  describe("when a user signs up and their organization is created", () => {
    /** @scenario "A new organization is created on the engine" */
    it("records it as being on the engine", async () => {
      const { prisma, tx } = recordingPrisma();
      const { writer } = writerSpy();

      await new PrismaOrganizationRepository(prisma, writer).createAndAssign(
        CREATE_INPUT,
      );

      expect(tx.systemMigrationTenantState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          migrationName: "authz-engine",
          tenantId: "org_new",
          status: "finalized",
        }),
      });
    });

    /** @scenario "A new organization is on the engine before its first grants" */
    it("writes the status row before the membership and the founder's grants", async () => {
      const { prisma, calls } = recordingPrisma();
      const { writer, attachBindings } = writerSpy();

      await new PrismaOrganizationRepository(prisma, writer).createAndAssign(
        CREATE_INPUT,
      );

      // The gate is read by `attachBindings`. If the status row landed after
      // it, the founder's two ADMIN grants would take the LEGACY path and the
      // organization would only claim to be on the engine.
      expect(calls.indexOf("systemMigrationTenantState.create")).toBeLessThan(
        calls.indexOf("organizationUser.create"),
      );
      expect(
        calls.indexOf("systemMigrationTenantState.create"),
      ).toBeGreaterThan(-1);
      // And the grants are attached only after the transaction has run at all.
      expect(attachBindings).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A new organization is not enrolled in the migration" */
    it("writes no enrollment row", async () => {
      const { prisma, tx } = recordingPrisma();
      const { writer } = writerSpy();

      await new PrismaOrganizationRepository(prisma, writer).createAndAssign(
        CREATE_INPUT,
      );

      // Enrollment means an operator paced this organization into a rollout.
      // Nobody paced this one, and naming its founder as the enroller would
      // put a fiction in the table the ops page attributes by name.
      expect(tx.systemMigrationEnrollment.create).not.toHaveBeenCalled();
    });

    /** @scenario "A new organization's state says it was never migrated" */
    it("records a report that does not claim a parity proof ran", async () => {
      const { prisma, tx } = recordingPrisma();
      const { writer } = writerSpy();

      await new PrismaOrganizationRepository(prisma, writer).createAndAssign(
        CREATE_INPUT,
      );

      const written = tx.systemMigrationTenantState.create.mock.calls[0]?.[0] as
        | { data: { report: { kind: string } } }
        | undefined;

      expect(written?.data.report.kind).toBe("authz_engine_new_organization");
    });
  });

  describe("when an organization is provisioned rather than signed up for", () => {
    /** @scenario "A provisioned organization is created on the engine too" */
    it("records it as being on the engine as well", async () => {
      const { prisma, tx } = recordingPrisma();
      const { writer } = writerSpy();

      await new PrismaOrganizationRepository(
        prisma,
        writer,
      ).createForProvisioning(CREATE_INPUT);

      expect(tx.systemMigrationTenantState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "org_new",
          status: "finalized",
        }),
      });
    });
  });
});
