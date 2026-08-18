/**
 * @vitest-environment node
 *
 * ADR-092 §13, delivery-plan PR 3: the cutover is a proof and then a fact.
 *
 * The migration may only flip an organization onto the engine after it has
 * decided every registry permission twice - once through the legacy head,
 * once through the ledger's own - and found no disagreement. This suite runs
 * that pass end to end against a real Postgres: the real command handlers, the
 * real reducer inside the real fold, the real two-headed store, and the real
 * engine deciding the proof. Only the queue leg is inline, exactly as in
 * `ledger-instant-revoke.integration.test.ts`.
 *
 * The last assertion is the point of the whole PR. A fact is put on the grant
 * head and NOWHERE else, and the permission seam is asked. Legacy cannot
 * answer it - there is no binding row to answer with - so a permitted check is
 * proof the engine decided, in production code, for a real organization.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { GRANTS_CUTOVER_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  OrganizationUserRole,
  type Project,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resolveProjectPermission } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import {
  COMPLETE_CUTOVER_COMMAND_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { resetCutoverGateForTesting } from "../cutover-gate";
import {
  type AppendedCommand,
  cutoverMigrations,
  inlineGrantsLedger,
  runMigrationPassForTenant,
} from "./cutover-pass.harness";

const ns = `authz-cutover-fork-${nanoid(8)}`;

/** How many passes the pass may take. One is expected; three is patience. */
const MAX_PASSES = 3;

describe("given an organization whose cutover pass runs to a clean proof", () => {
  const ledger = inlineGrantsLedger(prisma);

  let organization: Organization;
  let team: Team;
  let project: Project;
  let userId: string;

  const session = () => ({ user: { id: userId } }) as unknown as Session;

  const commandsOfType = (type: string): AppendedCommand[] =>
    ledger.appended.filter(
      (command) =>
        command.type === type && command.aggregateId === organization.id,
    );

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Cutover Fork Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Cutover Fork Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Cutover Fork Project",
        slug: `--test-project-${ns}`,
        apiKey: `--test-key-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });
    const user = await prisma.user.create({
      data: { name: "Cutover Member", email: `${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    // The legacy membership the backfill promotes, so the pass has real work
    // to do and the genesis import has a real row to adopt.
    await prisma.teamUser.create({
      data: { userId, teamId: team.id, role: TeamUserRole.MEMBER },
    });

    const migrations = cutoverMigrations({
      prisma,
      ledger: ledger.emitter,
      // Injected rather than AUTHZ_CUTOVER_COHORT: the knob is a process.env
      // read in production, and this suite is about what the pass does once
      // the organization is in the cohort.
      cutoverCohort: (tenantId) => tenantId === organization.id,
    });
    // Exiting this loop unfinished would leave the assertions below failing
    // on the flip rather than on the reason it never happened, so the loop
    // names what held it.
    let lastReport: unknown = null;
    let finalized = false;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      await runMigrationPassForTenant({
        prisma,
        organizationId: organization.id,
        migrations,
      });
      const record = await prisma.systemMigrationTenantState.findUnique({
        where: {
          migrationName_tenantId: {
            migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
            tenantId: organization.id,
          },
        },
      });
      lastReport = record?.report ?? record?.status ?? null;
      if (record?.status === "finalized") {
        finalized = true;
        break;
      }
    }
    if (!finalized) {
      throw new Error(
        `the cutover pass did not finalize in ${MAX_PASSES} passes; it last reported ${JSON.stringify(
          lastReport,
        )}`,
      );
    }
  });

  afterAll(async () => {
    // Every row this suite creates is named, and every id is read the
    // guarded way: `cleanupTestRows` refuses an entry it cannot identify and
    // reports it, which is only reachable if the id arrives as undefined
    // rather than as a TypeError one line earlier.
    await cleanupTestRows(prisma, [
      ["grantUsage", { organizationId: organization?.id }],
      ["shareLink", { projectId: project?.id }],
      ["grant", { organizationId: organization?.id }],
      ["role", { organizationId: organization?.id }],
      ["roleBinding", { organizationId: organization?.id }],
      ["customRole", { organizationId: organization?.id }],
      ["authzProjectionCursor", { organizationId: organization?.id }],
      ["authzCutoverProjection", { organizationId: organization?.id }],
      ["systemMigrationTenantState", { tenantId: organization?.id }],
      ["teamUser", { teamId: team?.id }],
      ["organizationUser", { organizationId: organization?.id }],
      ["project", { id: project?.id }],
      ["team", { id: team?.id }],
      ["user", { id: userId }],
      ["organization", { id: organization?.id }],
    ]);
  });

  /** @scenario "A clean parity proof and the cutover are recorded as facts" */
  it("records the proof and the cutover, and the engine answers from there on", async () => {
    const record = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
          tenantId: organization.id,
        },
      },
    });
    expect(record?.status).toBe("finalized");

    // The parity proof is a FACT, and its empty diff list is what the proof
    // says: the two heads agreed on every permission at every scope.
    const parity = commandsOfType(PROVE_MIGRATION_PARITY_COMMAND_TYPE);
    expect(parity).toHaveLength(1);
    expect(parity[0]!.data).toMatchObject({ diffs: [] });

    // ...and the cutover is the fact that follows it, carrying its actor.
    const cutover = commandsOfType(COMPLETE_CUTOVER_COMMAND_TYPE);
    expect(cutover).toHaveLength(1);
    expect(cutover[0]!.data).toMatchObject({
      actor: { type: "system", id: "system:grants-cutover" },
    });

    // The projection the request-path fork reads.
    const projection = await prisma.authzCutoverProjection.findUnique({
      where: { organizationId: organization.id },
    });
    expect(projection?.onEngine).toBe(true);
    expect(projection?.provedAt).not.toBeNull();

    // A fact on the grant head and nowhere else: PROJECT-scoped admin, with
    // no compat binding row behind it. Only the engine can answer with it.
    const engineOnlyGrantId = `grant_${ns}_engine_only`;
    await prisma.grant.create({
      data: {
        id: engineOnlyGrantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.USER,
        principalId: userId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: GrantScopeType.PROJECT,
        scopeId: project.id,
        occurredAt: new Date(),
      },
    });
    expect(
      await prisma.roleBinding.count({
        where: { organizationId: organization.id, id: engineOnlyGrantId },
      }),
    ).toBe(0);

    // The gate caches per organization for a minute, and the cutover landed
    // inside this process.
    resetCutoverGateForTesting();

    const decision = await resolveProjectPermission(
      { prisma, session: session() },
      project.id,
      "project:delete",
    );

    expect(decision).toEqual({ permitted: true, organizationRole: "MEMBER" });

    // The reverse-shadow thunk is detached; let it finish against the rows
    // this suite is about to delete.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
