/**
 * ADR-092 §13, delivery plan PR 3 — the cutover: one organization at a
 * time, proof first.
 *
 * The backfill made the legacy team rows expressible as grants; the genesis
 * import made everything that already existed a ledger fact. What is left is
 * everything the legacy schema kept OUTSIDE its bindings — a share link, an
 * EXTERNAL membership row, a project's own API key, an operator listed in an
 * environment variable — plus the one decision this whole workstream exists
 * to make: whether the engine may answer for this organization instead of
 * the legacy resolver.
 *
 * So this migration is a machine with a gate at each end. It runs only after
 * the other two finalized for the tenant (there is nothing left over until
 * they are done), and only for an organization in the cutover cohort — a
 * knob of its own, so the earlier stages can go wide while the flip advances
 * org by org. In between it imports the remaining facts, then proves twice:
 *
 *   1. The RESOURCE import proof — every ShareLink row is reproduced by a
 *      Grant row, field for field. Cheap, exact, and it catches a mapping
 *      mistake before any decision depends on it.
 *   2. The DECISION parity proof — for every member and every API key, every
 *      permission in the registry at every scope in the organization,
 *      decided TWICE: once over grants collected from the legacy compat
 *      heads, once over grants collected from the ledger's own projection.
 *      Any disagreement holds the organization and is recorded as a fact.
 *      This is the universal guard: it does not care what the two readers
 *      disagree ABOUT, only that they must not.
 *
 * Clean, and only then, the cutover becomes a fact: `migration_parity_proved`
 * with an empty diff list, `cutover_completed`, and the flip is observed on
 * the projection the request-path gate reads before the tenant finalizes.
 *
 * Everything here is idempotent, which is what makes the runner's "a parked
 * tenant simply runs again" contract enough on its own — a re-run re-emits
 * byte-identical commands (deterministic ids, business time from the source
 * rows), the event store dedupes them, and the proofs re-read live state. A
 * `previous` record therefore needs no special-casing at all.
 *
 * Dormant facts (decision 13): the lite-member, project-credential and
 * PLATFORM rows this import writes are STORED but no PR-3 decision reads
 * them — the engine still infers those answers exactly as it does today,
 * which is what keeps the parity proof passing. They become load-bearing at
 * contract.
 *
 * Spec: specs/rbac/in-place-authz-migration.feature.
 */
import {
  ALL_PERMISSIONS,
  AuthzEngine,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import type { AuthzCollectorService } from "./authz-collector.service";
import type {
  AuthzCutoverRepository,
  ExternalMemberFact,
  OrganizationScopeInventory,
  PlatformAdminUserFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ShareLinkFactRow,
} from "./authz-migration.repository";
import { GRANTS_CUTOVER_MIGRATION_NAME } from "./cutover.name";
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "./genesis-import.name";
import { deriveGrantId } from "./ledger/grant-identity";
import type {
  GrantsLedgerActor,
  LedgerPrincipal,
} from "./ledger/grants-ledger.reducer";
import type {
  BackfillGrantEmission,
  GrantsLedgerEmitter,
} from "./team-user-backfill.migration";
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "./team-user-backfill.name";

/**
 * The aggregate platform-scope facts live on.
 *
 * A PLATFORM grant is tenantless by definition — an operator's access is not
 * an organization's fact, and copying one row per organization would make
 * the same access N facts that can drift apart. One reserved aggregate keeps
 * platform facts event-sourced like everything else, and because every
 * organization's cutover emits them with IDENTICAL deterministic command ids
 * and grant ids, the hundredth cutover to reach this step appends nothing:
 * the event store dedupes on the key it has already seen.
 *
 * "platform" is not an organization id and can never collide with one (ids
 * are prefixed KSUIDs), which is what lets it share the table.
 */
export const PLATFORM_AUTHZ_TENANT_ID = "platform";

/** The actor on every fact this migration authors: no human performed it. */
const CUTOVER_ACTOR: GrantsLedgerActor = {
  type: "system",
  id: "system:grants-cutover",
};

/** Entries per command — one command appends one event batch. */
const CUTOVER_CHUNK = 500;

/** Reports stay bounded however far the two readers disagree. */
const MAX_REPORTED_DIFFS = 50;

/** The parity FACT stays bounded too: it is evidence in an event payload,
 *  not a dump. The report names the total either way. */
const MAX_PROVEN_DIFFS = 200;

const DEFAULT_POLL = { intervalMs: 500, timeoutMs: 120_000 };

/** The single permission a share link has ever conferred (ADR-057). */
const SHARE_PERMISSION = "traces:view";

/** The prerequisite migrations, in the order they must have finalized. */
const PREREQUISITE_MIGRATIONS: readonly string[] = [
  TEAM_USER_BACKFILL_MIGRATION_NAME,
  GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
];

/** One way an imported share link is not reproduced by its Grant row. */
export type CutoverResourceDiff = {
  kind: "resource_missing" | "resource_changed";
  id: string;
  field?: string;
  expected?: string | null;
  actual?: string | null;
};

export type CutoverDeps = {
  repository: AuthzCutoverRepository;
  ledger: GrantsLedgerEmitter;
  /**
   * The decision-parity proof's two readers, explicit and separate
   * (D-PR3-12). Never the cutover-aware decorator: the whole point is to
   * compare the heads BEFORE the flip, and a decorator would answer from
   * the same head twice.
   */
  collectors: {
    legacy: AuthzCollectorService;
    grants: AuthzCollectorService;
  };
  /**
   * Whether this organization may cut over yet. Composed in the app from
   * the cohort helper and its own environment knob — the package reads no
   * environment of its own.
   */
  cutoverCohort: (tenantId: string) => boolean;
  /** The platform-admin email list, as the live admin check parses it. */
  adminEmails: () => string[];
  now: () => number;
  /** How long to wait for the projection before parking. */
  poll?: { intervalMs: number; timeoutMs: number };
};

/** What one pass imported, for the tenant's report. */
type CutoverCounts = {
  shareLinks: number;
  liteMembers: number;
  projectCredentials: number;
  platformGrants: number;
};

export class GrantsCutoverMigration implements SystemMigration {
  readonly name = GRANTS_CUTOVER_MIGRATION_NAME;
  private readonly engine = new AuthzEngine();

  constructor(private readonly deps: CutoverDeps) {}

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;

    const awaiting = await this.unfinishedPrerequisites({ tenantId });
    if (awaiting.length > 0) {
      return {
        status: "migrated",
        report: { kind: "cutover_waiting", awaiting },
      };
    }
    if (!this.deps.cutoverCohort(tenantId)) {
      return { status: "migrated", report: { kind: "cutover_waiting_cohort" } };
    }

    const { emissions, unmatchedAdminEmails } = await this.planImport({
      organizationId,
    });
    const counts: CutoverCounts = {
      shareLinks: emissions.shareLinks.length,
      liteMembers: emissions.liteMembers.length,
      projectCredentials: emissions.projectCredentials.length,
      platformGrants: emissions.platform.length,
    };

    await this.emit({ organizationId, emissions, signal });
    await this.awaitConvergence({ organizationId, emissions, signal });

    const resourceDiffs = await this.proveResourceImport({ organizationId });
    if (resourceDiffs.length > 0) {
      return {
        status: "migrated",
        report: {
          kind: "cutover_resource_drift",
          ...counts,
          unmatchedAdminEmails,
          totalDiffs: resourceDiffs.length,
          diffs: resourceDiffs.slice(0, MAX_REPORTED_DIFFS),
        },
      };
    }

    const parity = await this.proveDecisionParity({ organizationId, signal });
    if (parity.diffs.length > 0) {
      // The disagreement is recorded as a fact before the tenant is held:
      // the ledger is where the argument lives, the report is where an
      // operator reads it. Deterministic commandId, so a crash between this
      // send and the state write re-runs and dedupes.
      await this.deps.ledger.proveMigrationParity({
        organizationId,
        commandId: `cutover:parity:${organizationId}`,
        diffs: parity.diffs.slice(0, MAX_PROVEN_DIFFS),
        occurredAtMs: this.deps.now(),
      });
      return {
        status: "migrated",
        report: {
          kind: "cutover_parity_diffs",
          ...counts,
          ...parity.verified,
          unmatchedAdminEmails,
          totalDiffs: parity.diffs.length,
          diffs: parity.diffs.slice(0, MAX_REPORTED_DIFFS),
        },
      };
    }

    await this.deps.ledger.proveMigrationParity({
      organizationId,
      commandId: `cutover:parity:${organizationId}`,
      diffs: [],
      occurredAtMs: this.deps.now(),
    });
    await this.deps.ledger.completeCutover({
      organizationId,
      commandId: `cutover:complete:${organizationId}`,
      actor: CUTOVER_ACTOR,
      occurredAtMs: this.deps.now(),
    });
    await this.awaitCutoverOnEngine({ organizationId, signal });

    return {
      status: "finalized",
      report: {
        kind: "cutover_clean",
        ...counts,
        ...parity.verified,
        unmatchedAdminEmails,
      },
    };
  }

  /**
   * The prerequisite read. Anything other than `finalized` — never run,
   * held, parked, rolled back — means the facts this import expects to find
   * already stated may not be there, so the tenant waits rather than
   * importing onto an unfinished floor.
   */
  private async unfinishedPrerequisites({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<string[]> {
    const statuses = await this.deps.repository.findMigrationTenantStatuses({
      tenantId,
      migrationNames: PREREQUISITE_MIGRATIONS,
    });
    return PREREQUISITE_MIGRATIONS.filter(
      (name) => statuses[name] !== "finalized",
    );
  }

  /**
   * Everything the import will say, computed before anything is said. The
   * order inside each list is deterministic (sorted by the source row's own
   * id), so a retried pass chunks identically and its commands carry the
   * same ids.
   */
  private async planImport({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{
    emissions: PlannedEmissions;
    unmatchedAdminEmails: string[];
  }> {
    const [shareLinkRows, externalMembers, projectCredentials] =
      await Promise.all([
        this.deps.repository.findShareLinkRows({ organizationId }),
        this.deps.repository.findExternalMemberFacts({ organizationId }),
        this.deps.repository.findProjectCredentialFacts({ organizationId }),
      ]);
    const emails = normalizedAdminEmails(this.deps.adminEmails());
    const admins =
      emails.length === 0
        ? []
        : await this.deps.repository.findUsersByEmail({ emails });
    const matched = new Set(admins.map((user) => user.email.toLowerCase()));

    return {
      emissions: {
        shareLinks: shareLinkRows
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((row) => shareLinkEmission({ organizationId, row })),
        liteMembers: externalMembers
          .slice()
          .sort((a, b) => a.userId.localeCompare(b.userId))
          .map((member) => liteMemberEmission({ organizationId, member })),
        projectCredentials: projectCredentials
          .slice()
          .sort((a, b) => a.projectId.localeCompare(b.projectId))
          .map((project) => projectCredentialEmission({ organizationId, project })),
        platform: admins
          .slice()
          .sort((a, b) => a.userId.localeCompare(b.userId))
          .map((user) => platformEmission({ user })),
      },
      // Not fatal, and deliberately so: ADMIN_EMAILS stays the LIVE authority
      // for platform access until contract (decision 13), so an address with
      // no account behind it changes nothing about who can do what. It is
      // reported because it is almost always a typo or a departed colleague.
      unmatchedAdminEmails: emails.filter((email) => !matched.has(email)),
    };
  }

  /** Chunked sends, aborting between chunks like the genesis import. */
  private async emit({
    organizationId,
    emissions,
    signal,
  }: {
    organizationId: string;
    emissions: PlannedEmissions;
    signal?: AbortSignal;
  }): Promise<void> {
    const perOrganization: Array<[string, BackfillGrantEmission[]]> = [
      ["share-links", emissions.shareLinks],
      ["lite-members", emissions.liteMembers],
      ["project-keys", emissions.projectCredentials],
    ];
    for (const [label, grants] of perOrganization) {
      for (const [index, chunk] of chunked(grants).entries()) {
        this.assertNotAborted(signal);
        await this.deps.ledger.attachGrants({
          organizationId,
          commandId: `cutover:${label}:${organizationId}:${index}`,
          grants: chunk,
        });
      }
    }
    // The sentinel aggregate, addressed as its own tenant. The commandId
    // carries no organization on purpose: every organization's cutover
    // emits exactly this command, and the event store dedupes it.
    for (const [index, chunk] of chunked(emissions.platform).entries()) {
      this.assertNotAborted(signal);
      await this.deps.ledger.attachGrants({
        organizationId: PLATFORM_AUTHZ_TENANT_ID,
        commandId: `cutover:platform:${index}`,
        grants: chunk,
      });
    }
  }

  /**
   * Block until every emitted fact is in the heads, genesis-style. The
   * proofs read what the fold wrote, so sweeping early would report drift
   * for work that is merely in flight. Timing out throws: the tenant parks,
   * and the next pass waits again against events that are already durable.
   */
  private async awaitConvergence({
    organizationId,
    emissions,
    signal,
  }: {
    organizationId: string;
    emissions: PlannedEmissions;
    signal?: AbortSignal;
  }): Promise<void> {
    const organizationGrantIds = [
      ...emissions.shareLinks,
      ...emissions.liteMembers,
      ...emissions.projectCredentials,
    ].map((grant) => grant.grantId);
    const platformGrantIds = emissions.platform.map((grant) => grant.grantId);
    if (organizationGrantIds.length === 0 && platformGrantIds.length === 0) {
      return;
    }

    await this.pollUntil({
      what: `the cutover import for ${organizationId}`,
      signal,
      check: async () => {
        const [organizationHeads, platformHeads] = await Promise.all([
          organizationGrantIds.length === 0
            ? Promise.resolve<string[]>([])
            : this.deps.repository.findGrantHeadIds({ organizationId }),
          platformGrantIds.length === 0
            ? Promise.resolve<string[]>([])
            : this.deps.repository.findGrantHeadIds({
                organizationId: PLATFORM_AUTHZ_TENANT_ID,
              }),
        ]);
        const present = new Set([...organizationHeads, ...platformHeads]);
        return [...organizationGrantIds, ...platformGrantIds].every((id) =>
          present.has(id),
        );
      },
    });
  }

  /** The flip itself, observed where the request path reads it. */
  private async awaitCutoverOnEngine({
    organizationId,
    signal,
  }: {
    organizationId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.pollUntil({
      what: `the cutover of ${organizationId}`,
      signal,
      check: () => this.deps.repository.findCutoverOnEngine({ organizationId }),
    });
  }

  private async pollUntil({
    what,
    check,
    signal,
  }: {
    what: string;
    check: () => Promise<boolean>;
    signal?: AbortSignal;
  }): Promise<void> {
    const poll = this.deps.poll ?? DEFAULT_POLL;
    const deadline = this.deps.now() + poll.timeoutMs;
    for (;;) {
      this.assertNotAborted(signal);
      if (await check()) return;
      if (this.deps.now() >= deadline) {
        throw new Error(
          `grants projection did not land ${what} within ${poll.timeoutMs}ms; tenant parked for retry`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }

  /**
   * The import proof: every original ShareLink row is reproduced by a Grant
   * row, field for field. Both sides are re-read — the import ran in
   * between, and what this asserts is that the resource tier now says
   * exactly what the legacy table says.
   */
  private async proveResourceImport({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CutoverResourceDiff[]> {
    const [rows, grantRows] = await Promise.all([
      this.deps.repository.findShareLinkRows({ organizationId }),
      this.deps.repository.findResourceGrantRows({ organizationId }),
    ]);
    const byId = new Map(grantRows.map((row) => [row.grantId, row]));
    return rows.flatMap((row) =>
      resourceDiffs({ organizationId, row, grant: byId.get(row.id) }),
    );
  }

  /**
   * The universal guard (D-PR3-12), generalising the backfill's parity
   * sweep from one reader answered twice to two readers answered once each:
   * collect ONE snapshot per principal per reader, then let the pure engine
   * decide every (permission x scope) pair in memory. The collects are the
   * only queries per principal — the decisions cost nothing but CPU, which
   * is what makes sweeping the whole registry affordable.
   */
  private async proveDecisionParity({
    organizationId,
    signal,
  }: {
    organizationId: string;
    signal?: AbortSignal;
  }): Promise<{
    diffs: string[];
    verified: { membersVerified: number; apiKeysVerified: number };
  }> {
    const [memberIds, apiKeyIds, inventory] = await Promise.all([
      this.deps.repository.findOrganizationMemberIds({ organizationId }),
      this.deps.repository.findOrganizationApiKeyIds({ organizationId }),
      this.deps.repository.findOrganizationTeamAndProjectIds({
        organizationId,
      }),
    ]);
    const scopes = scopesOf({ organizationId, inventory });
    const diffs: string[] = [];

    for (const userId of memberIds) {
      // Throw rather than return what we have: an aborted sweep proves
      // nothing, and a short diff list reads as "clean" - which would cut
      // the organization over on a proof that never finished.
      this.assertNotAborted(signal);
      const principal = { type: "user" as const, id: userId };
      const [legacy, grants] = await Promise.all([
        this.deps.collectors.legacy.collectGrants({ principal, organizationId }),
        this.deps.collectors.grants.collectGrants({ principal, organizationId }),
      ]);
      diffs.push(
        ...this.decisionDiffs({
          label: `user:${userId}`,
          scopes,
          decideLegacy: (permission, scope) =>
            this.engine.decide({ grants: legacy, permission, scope }).allowed,
          decideEngine: (permission, scope) =>
            this.engine.decide({ grants, permission, scope }).allowed,
        }),
      );
    }

    for (const apiKeyId of apiKeyIds) {
      this.assertNotAborted(signal);
      const principal = { type: "apiKey" as const, id: apiKeyId };
      const [legacy, grants] = await Promise.all([
        this.deps.collectors.legacy.collectGrants({ principal, organizationId }),
        this.deps.collectors.grants.collectGrants({ principal, organizationId }),
      ]);
      // The §9 owner ceiling is part of a key's answer, so it is part of the
      // comparison: each reader supplies its OWN owner snapshot, or the
      // proof would compare two keys against one ceiling.
      const [legacyOwner, grantsOwner] = await Promise.all([
        this.ownerGrants({
          collector: this.deps.collectors.legacy,
          apiKeyId,
          organizationId,
        }),
        this.ownerGrants({
          collector: this.deps.collectors.grants,
          apiKeyId,
          organizationId,
        }),
      ]);
      diffs.push(
        ...this.decisionDiffs({
          label: `api_key:${apiKeyId}`,
          scopes,
          decideLegacy: (permission, scope) =>
            this.engine.decideWithCeiling({
              keyGrants: legacy,
              ownerGrants: legacyOwner,
              permission,
              scope,
            }).allowed,
          decideEngine: (permission, scope) =>
            this.engine.decideWithCeiling({
              keyGrants: grants,
              ownerGrants: grantsOwner,
              permission,
              scope,
            }).allowed,
        }),
      );
    }

    return {
      diffs,
      verified: {
        membersVerified: memberIds.length,
        apiKeysVerified: apiKeyIds.length,
      },
    };
  }

  private async ownerGrants({
    collector,
    apiKeyId,
    organizationId,
  }: {
    collector: AuthzCollectorService;
    apiKeyId: string;
    organizationId: string;
  }): Promise<CollectedGrants | null> {
    const owner = await collector.findApiKeyOwner({ apiKeyId });
    if (!owner?.userId) return null;
    return collector.collectGrants({
      principal: { type: "user", id: owner.userId },
      organizationId,
    });
  }

  /** Every (permission x scope) pair for one principal, in memory. The two
   *  deciders are closed over their own snapshot (and, for a key, its own
   *  owner ceiling), so the only thing that differs between them is which
   *  head the grants were read from. */
  private decisionDiffs({
    label,
    scopes,
    decideLegacy,
    decideEngine,
  }: {
    label: string;
    scopes: AuthzScopeRef[];
    decideLegacy: (permission: string, scope: AuthzScopeRef) => boolean;
    decideEngine: (permission: string, scope: AuthzScopeRef) => boolean;
  }): string[] {
    const diffs: string[] = [];
    for (const scope of scopes) {
      for (const permission of ALL_PERMISSIONS) {
        const fromLegacy = decideLegacy(permission, scope);
        const fromEngine = decideEngine(permission, scope);
        if (fromLegacy !== fromEngine) {
          diffs.push(
            `${label} ${permission} ${scope.type}:${scope.id} legacy=${fromLegacy} engine=${fromEngine}`,
          );
        }
      }
    }
    return diffs;
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error(
        "cutover aborted before completing; tenant parked for retry",
      );
    }
  }
}

/** The four emission families, planned before any of them is sent. */
type PlannedEmissions = {
  shareLinks: BackfillGrantEmission[];
  liteMembers: BackfillGrantEmission[];
  projectCredentials: BackfillGrantEmission[];
  platform: BackfillGrantEmission[];
};

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CUTOVER_CHUNK) {
    chunks.push(items.slice(i, i + CUTOVER_CHUNK));
  }
  return chunks;
}

/**
 * A share link as the ledger will attach it. The grant id IS the ShareLink
 * row's id — adoption, exactly as the genesis import adopts a binding's:
 * the compat head then converges onto this very row, and the token a
 * customer already circulated keeps resolving to it.
 */
function shareLinkEmission({
  organizationId,
  row,
}: {
  organizationId: string;
  row: ShareLinkFactRow;
}): BackfillGrantEmission {
  return {
    grantId: row.id,
    principal: shareLinkPrincipal({ organizationId, row }),
    // Resource facts carry no role: their single permission is in the terms.
    roleKey: null,
    scope: { type: "RESOURCE", id: row.resourceId },
    resource: {
      kind: row.resourceType === "THREAD" ? "thread" : "trace",
      projectId: row.projectId,
      token: row.token,
      permission: SHARE_PERMISSION,
      ...(row.userId === null ? {} : { createdByUserId: row.userId }),
      ...(row.expiresAtMs === null ? {} : { expiresAtMs: row.expiresAtMs }),
      ...(row.maxViews === null ? {} : { maxViews: row.maxViews }),
    },
    source: "cutover-import",
    occurredAtMs: row.createdAtMs,
    actor: CUTOVER_ACTOR,
  };
}

/** The audience an ADR-057 visibility means, as a ledger principal. */
function shareLinkPrincipal({
  organizationId,
  row,
}: {
  organizationId: string;
  row: Pick<ShareLinkFactRow, "visibility" | "projectId">;
}): LedgerPrincipal {
  switch (row.visibility) {
    case "PUBLIC":
      return { type: "anyone", id: null };
    case "ORGANIZATION":
      return { type: "organization", id: organizationId };
    case "PROJECT":
      return { type: "project", id: row.projectId };
    default: {
      // A visibility added to the stored enum without a principal here would
      // otherwise fall out as undefined and import a link nobody can match.
      const unreachable: never = row.visibility;
      throw new Error(`unhandled share link visibility: ${String(unreachable)}`);
    }
  }
}

/**
 * An EXTERNAL membership, stated as the org-scoped lite-member grant the
 * legacy schema kept as a column on the membership row. Dormant in PR 3:
 * the engine's EXTERNAL cap still comes from the membership read.
 */
function liteMemberEmission({
  organizationId,
  member,
}: {
  organizationId: string;
  member: ExternalMemberFact;
}): BackfillGrantEmission {
  const principal = { type: "user" as const, id: member.userId };
  const scope = { type: "ORGANIZATION" as const, id: organizationId };
  return {
    grantId: deriveGrantId({
      organizationId,
      principal,
      scope,
      occurredAtMs: member.createdAtMs,
    }),
    principal,
    roleKey: "lite-member",
    scope,
    source: "cutover-import",
    occurredAtMs: member.createdAtMs,
    actor: CUTOVER_ACTOR,
  };
}

/**
 * The legacy per-project credential (`Project.apiKey`) as a fact: the
 * PROJECT itself is the principal, because that key authenticates as the
 * project and names no user or key row at all.
 *
 * These are the ADR's dormant facts in their purest form — no seam reads
 * them in PR 3, and nothing in this PR's decisions changes because they
 * exist. The contract PR's edge identity is what will resolve a project
 * credential to this grant instead of to a bare column comparison.
 */
function projectCredentialEmission({
  organizationId,
  project,
}: {
  organizationId: string;
  project: ProjectCredentialFact;
}): BackfillGrantEmission {
  const principal = { type: "project" as const, id: project.projectId };
  const scope = { type: "PROJECT" as const, id: project.projectId };
  return {
    grantId: deriveGrantId({
      organizationId,
      principal,
      scope,
      occurredAtMs: project.createdAtMs,
    }),
    principal,
    roleKey: "admin",
    scope,
    source: "cutover-import",
    occurredAtMs: project.createdAtMs,
    actor: CUTOVER_ACTOR,
  };
}

/**
 * A platform operator, on the sentinel aggregate. Everything about this
 * fact — the aggregate, the derived grant id, the command id — is a
 * function of the user alone, never of the organization whose cutover
 * happened to emit it, which is what makes the hundredth emission a no-op.
 */
function platformEmission({
  user,
}: {
  user: PlatformAdminUserFact;
}): BackfillGrantEmission {
  const principal = { type: "user" as const, id: user.userId };
  const scope = {
    type: "PLATFORM" as const,
    id: PLATFORM_AUTHZ_TENANT_ID,
  };
  return {
    grantId: deriveGrantId({
      organizationId: PLATFORM_AUTHZ_TENANT_ID,
      principal,
      scope,
      occurredAtMs: user.createdAtMs,
    }),
    principal,
    roleKey: "admin",
    scope,
    source: "cutover-import",
    occurredAtMs: user.createdAtMs,
    actor: CUTOVER_ACTOR,
  };
}

/** The admin list as the live check reads it: comma-separated, trimmed,
 *  case-insensitive, blanks dropped. */
function normalizedAdminEmails(raw: string[]): string[] {
  return [
    ...new Set(
      raw.map((email) => email.trim().toLowerCase()).filter((email) => email),
    ),
  ];
}

/** Every scope in the organization, with the lineage the engine's walk
 *  needs — teams carry their organization, projects their team and their
 *  organization. Both are already known here; no lookup is needed. */
function scopesOf({
  organizationId,
  inventory,
}: {
  organizationId: string;
  inventory: OrganizationScopeInventory;
}): AuthzScopeRef[] {
  return [
    { type: "organization", id: organizationId },
    ...inventory.teamIds.map(
      (teamId): AuthzScopeRef => ({
        type: "team",
        id: teamId,
        organizationId,
      }),
    ),
    ...inventory.projects.map(
      (project): AuthzScopeRef => ({
        type: "project",
        id: project.id,
        teamId: project.teamId,
        organizationId,
      }),
    ),
  ];
}

/** Field equality for one imported share link against its Grant row. The
 *  stored spellings differ on two columns (the kind is uppercase on both
 *  tables, the principal is an enum rather than a visibility), so the
 *  comparison is against what the import SAID, not a raw column copy. */
function resourceDiffs({
  organizationId,
  row,
  grant,
}: {
  organizationId: string;
  row: ShareLinkFactRow;
  grant: ResourceGrantRow | undefined;
}): CutoverResourceDiff[] {
  if (!grant) {
    return [{ kind: "resource_missing", id: row.id }];
  }
  const principal = shareLinkPrincipal({ organizationId, row });
  const compared: Array<[string, string | null, string | null]> = [
    ["token", row.token, grant.token],
    ["kind", row.resourceType, (grant.resourceKind ?? "").toUpperCase() || null],
    ["resourceId", row.resourceId, grant.resourceId],
    ["projectId", row.projectId, grant.projectId],
    ["principalType", ledgerPrincipalTypeDb(principal.type), grant.principalType],
    ["principalId", principal.id, grant.principalId],
    ["expiresAt", numberField(row.expiresAtMs), numberField(grant.expiresAtMs)],
    ["maxViews", numberField(row.maxViews), numberField(grant.maxViews)],
  ];
  return compared.flatMap(([field, expected, actual]) =>
    expected === actual
      ? []
      : [
          {
            kind: "resource_changed" as const,
            id: row.id,
            field,
            expected,
            actual,
          },
        ],
  );
}

/** The ledger's lowercase principal type as the column spells it. */
function ledgerPrincipalTypeDb(type: LedgerPrincipal["type"]): string {
  return type.toUpperCase();
}

function numberField(value: number | null): string | null {
  return value === null ? null : String(value);
}
