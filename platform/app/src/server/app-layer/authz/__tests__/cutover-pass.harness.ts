/**
 * The migration pass, wired for the datastore lane.
 *
 * ADR-092 delivery-plan PR 3's cutover is a THREE-migration pass — backfill,
 * genesis import, cutover — and every one of them waits for the fold to land
 * what it emitted before it proves anything. In production the transport
 * between the two is the event store and the per-organization queue; here the
 * command handlers and the fold run inline, against the same real Postgres
 * store the queue writes through.
 *
 * What that keeps real is everything the cutover is actually about: the real
 * command handlers and their wire schemas, the real reducer inside the real
 * fold projection, the real two-headed Prisma store, the real read
 * repositories over both heads, and the real engine deciding the parity proof.
 * What it drops is the queue leg — which is what
 * `ledger-instant-revoke.integration.test.ts` drops too, for the same reason:
 * a datastore-lane test provisions Postgres and Redis, not a running worker.
 *
 * Not a test file: `.harness.ts` is imported by the three
 * `cutover-*.integration.test.ts` suites and collected by none of them.
 */
import { AuthzCollectorService } from "@langwatch/authz-server";
import {
  GrantsCutoverMigration,
  GrantsGenesisImportMigration,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server/migration";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTenantId } from "~/server/event-sourcing";
import type { Event } from "~/server/event-sourcing/domain/types";
import {
  AttachGrantsCommand,
  CompleteCutoverCommand,
  DefineRolesCommand,
  DeleteRoleCommand,
  ProveMigrationParityCommand,
  RevokeGrantsCommand,
  RollBackCutoverCommand,
} from "~/server/event-sourcing/pipelines/authz-grants/commands/grantsLedgerCommands";
import {
  type AuthzGrantsFoldState,
  AuthzGrantsStateFoldProjection,
} from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import {
  ATTACH_GRANTS_COMMAND_TYPE,
  COMPLETE_CUTOVER_COMMAND_TYPE,
  DEFINE_ROLES_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
  REVOKE_GRANTS_COMMAND_TYPE,
  ROLL_BACK_CUTOVER_COMMAND_TYPE,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import type { AuthzGrantsEvent } from "~/server/event-sourcing/pipelines/authz-grants/schemas/events";
import { PrismaSystemMigrationStateRepository } from "../../system-migrations/repositories/system-migration-state.prisma.repository";
import { PrismaAuthzGrantsProjectionRepository } from "../repositories/authz-grants-projection.prisma.repository";
import { PrismaAuthzMigrationRepository } from "../repositories/authz-migration.prisma.repository";
import { GrantsAuthzReadRepository } from "../repositories/authz-read.grants.repository";
import { PrismaAuthzReadRepository } from "../repositories/authz-read.prisma.repository";
import { legacyOrganizationDecide } from "../repositories/cutover-parity.legacy-decide";
import { authzCollector } from "../runtime";

/** The fold runs inline, so a wait that never has to wait may be short. */
const IMMEDIATE_POLL = { intervalMs: 10, timeoutMs: 10_000 };

/** One command the harness carried, for tests that assert what was said. */
export type AppendedCommand = {
  type: string;
  aggregateId: string;
  commandId: string;
  data: unknown;
  events: number;
};

export type InlineLedger = {
  emitter: GrantsLedgerEmitter;
  /**
   * The operator's fact, which the emitter deliberately does NOT carry: a
   * migration may complete a cutover, only a human may roll one back.
   */
  rollBackCutover: (args: {
    organizationId: string;
    commandId: string;
    actorUserId: string;
    occurredAtMs: number;
  }) => Promise<void>;
  appended: AppendedCommand[];
};

/**
 * The ledger emitter the migrations write through: each call runs the real
 * command handler and folds the events it produced into the real Postgres
 * projection, under the aggregate the command addressed.
 */
export function inlineGrantsLedger(prisma: PrismaClient): InlineLedger {
  const store = new PrismaAuthzGrantsProjectionRepository(prisma);
  const projection = new AuthzGrantsStateFoldProjection({ store });
  const appended: AppendedCommand[] = [];

  /**
   * One command: handled by the real handler, then folded into the real
   * store under the aggregate the command addressed. `data` is kept
   * verbatim so a suite can assert what was SAID, the way the instant-revoke
   * suite asserts its appends.
   */
  const send = async <Data extends { commandId: string }>({
    handler,
    type,
    aggregateId,
    data,
  }: {
    handler: { handle: (command: never) => Promise<Event[]> };
    type: string;
    aggregateId: string;
    data: Data;
  }): Promise<void> => {
    const events = await handler.handle({
      tenantId: createTenantId(aggregateId),
      aggregateId,
      type,
      data: { ...data, tenantId: aggregateId, organizationId: aggregateId },
    } as never);
    appended.push({
      type,
      aggregateId,
      commandId: data.commandId,
      data,
      events: events.length,
    });
    if (events.length === 0) return;

    const context = { aggregateId, tenantId: createTenantId(aggregateId) };
    const loaded = await store.load(aggregateId, context);
    let state: AuthzGrantsFoldState = loaded?.state ?? projection.init();
    for (const event of events) {
      state = projection.apply(state, event as AuthzGrantsEvent);
    }
    const last = events[events.length - 1]!;
    const now = Date.now();
    await store.store(
      {
        state,
        cursor: { acceptedAt: now, eventId: last.id },
        occurredAt: last.occurredAt,
        createdAt: loaded?.createdAt ?? now,
        updatedAt: now,
        version: projection.version,
      },
      context,
    );
  };

  return {
    appended,
    emitter: {
      attachGrants: ({ organizationId, commandId, grants }) =>
        send({
          handler: new AttachGrantsCommand(),
          type: ATTACH_GRANTS_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, grants },
        }),
      defineRoles: ({ organizationId, commandId, roles, actor }) =>
        send({
          handler: new DefineRolesCommand(),
          type: DEFINE_ROLES_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, roles, actor },
        }),
      revokeGrants: ({
        organizationId,
        commandId,
        revocations,
        actor,
        occurredAtMs,
      }) =>
        send({
          handler: new RevokeGrantsCommand(),
          type: REVOKE_GRANTS_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, revocations, actor, occurredAtMs },
        }),
      deleteRole: ({
        organizationId,
        commandId,
        roleId,
        actor,
        occurredAtMs,
      }) =>
        send({
          handler: new DeleteRoleCommand(),
          type: DELETE_ROLE_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, roleId, actor, occurredAtMs },
        }),
      proveMigrationParity: ({
        organizationId,
        commandId,
        diffs,
        occurredAtMs,
      }) =>
        send({
          handler: new ProveMigrationParityCommand(),
          type: PROVE_MIGRATION_PARITY_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, diffs, occurredAtMs },
        }),
      completeCutover: ({ organizationId, commandId, actor, occurredAtMs }) =>
        send({
          handler: new CompleteCutoverCommand(),
          type: COMPLETE_CUTOVER_COMMAND_TYPE,
          aggregateId: organizationId,
          data: { commandId, actor, occurredAtMs },
        }),
    },
    rollBackCutover: ({
      organizationId,
      commandId,
      actorUserId,
      occurredAtMs,
    }) =>
      send({
        handler: new RollBackCutoverCommand(),
        type: ROLL_BACK_CUTOVER_COMMAND_TYPE,
        aggregateId: organizationId,
        data: {
          commandId,
          actor: { type: "user" as const, id: actorUserId },
          reason: "operator rollback",
          occurredAtMs,
        },
      }),
  };
}

/**
 * The three registered migrations, composed exactly as
 * `system-migrations/runtime.ts` composes them, with two deps injected rather
 * than read from the environment: the cutover cohort (a `process.env` read in
 * production, `AUTHZ_CUTOVER_COHORT`) and the platform-admin email list.
 *
 * The epoch bump is a no-op here. It is Redis work stage B already proves, and
 * this pass is about which facts land and who decides afterwards.
 */
export function cutoverMigrations({
  prisma,
  ledger,
  cutoverCohort = () => true,
  adminEmails = () => [],
}: {
  prisma: PrismaClient;
  ledger: GrantsLedgerEmitter;
  cutoverCohort?: (tenantId: string) => boolean;
  adminEmails?: () => string[];
}): SystemMigration[] {
  const repository = new PrismaAuthzMigrationRepository(prisma);
  return [
    new TeamUserBackfillMigration({
      repository,
      collectGrants: (args) => authzCollector.collectGrants(args),
      ledger,
      audit: async () => undefined,
      bumpEpoch: async () => undefined,
      now: () => Date.now(),
      poll: IMMEDIATE_POLL,
    }),
    new GrantsGenesisImportMigration({
      repository,
      ledger,
      now: () => Date.now(),
      poll: IMMEDIATE_POLL,
    }),
    new GrantsCutoverMigration({
      repository,
      ledger,
      // The proof's two readers, composed directly over the two heads and
      // never through the forking decorator (D-PR3-12).
      collectors: {
        legacy: new AuthzCollectorService(
          new PrismaAuthzReadRepository(prisma),
        ),
        grants: new AuthzCollectorService(
          new GrantsAuthzReadRepository(prisma),
        ),
      },
      // The third leg, composed exactly as production composes it: the real
      // `hasOrganizationPermission`, which at proof time still runs its
      // legacy body because the organization is not on the engine yet.
      legacyDecide: legacyOrganizationDecide(prisma),
      cutoverCohort,
      adminEmails,
      now: () => Date.now(),
      poll: IMMEDIATE_POLL,
    }),
  ];
}

/**
 * One pass over ONE organization, the way `SystemMigrationRunnerService` runs
 * it per tenant: each migration in registration order, its outcome recorded in
 * the same state table the next migration reads its prerequisites from, and a
 * tenant already finalized or rolled back left alone.
 *
 * Scoped to a single tenant on purpose — the real runner sweeps every
 * organization in the cohort, and a shared test database holds other suites'.
 */
export async function runMigrationPassForTenant({
  prisma,
  organizationId,
  migrations,
}: {
  prisma: PrismaClient;
  organizationId: string;
  migrations: SystemMigration[];
}): Promise<Record<string, TenantMigrationOutcome>> {
  const state = new PrismaSystemMigrationStateRepository(prisma);
  const outcomes: Record<string, TenantMigrationOutcome> = {};
  for (const migration of migrations) {
    const previous = await state.findRecord({
      migrationName: migration.name,
      tenantId: organizationId,
    });
    // The runner's own skip rule: finalized is the one-way latch and
    // rolled_back is the operator's pin. Neither is re-run, and neither
    // produces an outcome for this pass to report.
    if (
      previous?.status === "finalized" ||
      previous?.status === "rolled_back"
    ) {
      continue;
    }
    const outcome = await migration.migrateTenant({
      tenantId: organizationId,
      previous,
    });
    await state.upsertRecord({
      migrationName: migration.name,
      tenantId: organizationId,
      status: outcome.status,
      report: outcome.report ?? null,
    });
    outcomes[migration.name] = outcome;
  }
  return outcomes;
}
