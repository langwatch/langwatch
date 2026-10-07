/**
 * ADR-144 block B / ADR-166: the door. `authorize` evaluates one permission
 * on one project for one principal and mints the sealed proof every trace
 * read below the door carries by hand. Nothing below it evaluates
 * permissions again; the store client applies the proof.
 *
 * Home on `main`; ports to `modules/authz/process` with PR 7536.
 */
import {
  AccessNotGrantedError,
  type Actor,
  type Authorization,
  type AuthorizationCondition,
  type AuthorizationGrant,
  type AuthorizationPurpose,
  type GrantCondition,
  sealAuthorization,
} from "@langwatch/actor";
import {
  type AuthzPermission,
  type AuthzPrincipalRef,
  builtinRoleGrants,
  PROJECT_READER_ROLE_KEY,
} from "@langwatch/authz";
import type {
  AuthzCollectorService,
  AuthzEpochReader,
  AuthzService,
} from "@langwatch/authz-server";
import type {
  SharedReadRow,
  SharedReadsGrantsRepository,
} from "./repositories/shared-reads.grants.repository";

/** A proof never outlives this, whatever the grants say: the ceiling on
 *  how stale a route's view of access may be. */
export const AUTHORIZATION_MAX_AGE_MS = 5 * 60 * 1000;

/** How long a project's organisation is remembered for internal mints: it
 *  bounds how stale a remembered scope may be, for a project that has since
 *  been deleted. */
const INTERNAL_SCOPE_CACHE_MS = 60 * 1000;

/** Bounds the internal-mint scope cache's memory; the oldest entry goes
 *  first. */
export const INTERNAL_SCOPE_CACHE_MAX_ENTRIES = 5_000;

/**
 * Absolute ceiling on a cached shared-read lookup, epoch agreement or not,
 * the same as the engine's own snapshot cache: a wedged epoch store or a
 * swallowed bump cannot pin a revoked read past it.
 */
const SHARED_READS_CACHE_MAX_AGE_MS = 30_000;

/** Bounds the cache's memory; the oldest entry goes first. */
const SHARED_READS_CACHE_MAX_ENTRIES = 5_000;

export type AuthorizationServiceDeps = {
  authz: Pick<AuthzService, "effectivePermissions">;
  collector: Pick<AuthzCollectorService, "resolveScopeRef">;
  sharedReads: Pick<SharedReadsGrantsRepository, "findLiveSharedReads">;
  /**
   * The organisation's authz epoch, bumped on every grant write (attach and
   * revoke included), or null when nothing may be cached. With none wired,
   * or the flag off, every mint reads the ledger.
   */
  epochReader?: AuthzEpochReader;
  cacheEnabled?: () => boolean;
  now?: () => number;
};

type SharedReadsEntry = {
  epoch: number;
  rows: SharedReadRow[];
  storedAt: number;
};

export class AuthorizationService {
  private readonly internalScopes = new Map<
    string,
    { organizationId: string; until: number }
  >();
  private readonly sharedReadsCache = new Map<string, SharedReadsEntry>();

  constructor(private readonly deps: AuthorizationServiceDeps) {}

  /**
   * Mint the proof for platform code reading on its own behalf - a
   * projection folding a trace, a worker scoring one. No permission is
   * evaluated: the platform is trusted on its own data, and the proof
   * exists so the store client fences the read to the one project the
   * caller named rather than to a tenant it was handed by string. The own
   * grant carries only the permission asked for, and there is never a
   * shared grant: internal work does not read across projects.
   */
  async authorizeInternal({
    actor,
    projectId,
    permission,
    purpose,
  }: {
    actor: Extract<Actor, { type: "internal" | "system" }>;
    projectId: string;
    permission: AuthzPermission;
    purpose: AuthorizationPurpose;
  }): Promise<Authorization> {
    const now = this.deps.now?.() ?? Date.now();
    const organizationId = await this.organizationOf({ projectId, now });
    if (organizationId === undefined) {
      throw new AccessNotGrantedError(permission);
    }
    return sealAuthorization({
      actor,
      principal:
        actor.type === "system"
          ? { type: "system", name: actor.name }
          : { type: "internal", codePath: actor.codePath },
      scope: { organizationId },
      grants: [{ projectId, permissions: [permission], via: [], kind: "own" }],
      expiresAt: now + AUTHORIZATION_MAX_AGE_MS,
      purpose,
    });
  }

  private async organizationOf({
    projectId,
    now,
  }: {
    projectId: string;
    now: number;
  }): Promise<string | undefined> {
    const cached = this.internalScopes.get(projectId);
    if (cached !== undefined && cached.until > now)
      return cached.organizationId;
    const scopeRef = await this.deps.collector.resolveScopeRef({ projectId });
    if (scopeRef?.type !== "project") return undefined;
    this.internalScopes.delete(projectId);
    if (this.internalScopes.size >= INTERNAL_SCOPE_CACHE_MAX_ENTRIES) {
      const oldest = this.internalScopes.keys().next().value;
      if (oldest !== undefined) this.internalScopes.delete(oldest);
    }
    this.internalScopes.set(projectId, {
      organizationId: scopeRef.organizationId,
      until: now + INTERNAL_SCOPE_CACHE_MS,
    });
    return scopeRef.organizationId;
  }

  /**
   * Mint the proof for one route call. The own grant carries the caller's
   * full effective set on the project; each shared grant carries the one
   * permission the project-reader role confers and the window its ledger
   * row opens. A permission the role does not confer leaves the shared
   * grants out, so a manage call never reaches a member project.
   *
   * An unknown project and a denied permission both read as not granted:
   * the door does not say which.
   */
  async authorize({
    actor,
    principal,
    permission,
    scope,
    purpose,
  }: {
    actor: Actor;
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: { projectId: string };
    purpose: AuthorizationPurpose;
  }): Promise<Authorization> {
    const { authz, collector } = this.deps;
    const now = this.deps.now?.() ?? Date.now();

    const scopeRef = await collector.resolveScopeRef({
      projectId: scope.projectId,
    });
    if (scopeRef?.type !== "project") {
      throw new AccessNotGrantedError(permission);
    }
    // One engine pass: the effective set decides the permission asked for
    // and is what the own grant carries, so the door does not evaluate the
    // same grants twice per request.
    const permissions = await authz.effectivePermissions({
      principal,
      scope: scopeRef,
    });
    if (!permissions.includes(permission)) {
      throw new AccessNotGrantedError(permission);
    }
    const own: AuthorizationGrant = {
      projectId: scope.projectId,
      permissions,
      via: [],
      kind: "own",
    };

    const sharedPermitted = builtinRoleGrants({
      role: PROJECT_READER_ROLE_KEY,
      permission,
    });
    const rows = sharedPermitted
      ? await this.liveSharedReads({
          organizationId: scopeRef.organizationId,
          readerProjectId: scope.projectId,
          now,
        })
      : [];
    const { shared, expiresAt } = sharedGrantsFrom({
      rows,
      readerProjectId: scope.projectId,
      permission,
      now,
    });

    return sealAuthorization({
      actor,
      principal: proofPrincipal(principal),
      scope: { organizationId: scopeRef.organizationId },
      grants: [own, ...shared],
      expiresAt,
      purpose,
    });
  }

  /**
   * The reader's live shared reads, cached per organisation epoch (ADR-144,
   * Consequences): every proof-bearing call on every project mints, and an
   * aggregate's lookup reads one row per member. The epoch is read before
   * the rows, so a write that lands between the two bumps it past the entry
   * and the next mint reads afresh. Expiry and the reader naming itself are
   * still applied per mint, against the rows, so a cached row never outlives
   * its grant.
   */
  private async liveSharedReads({
    organizationId,
    readerProjectId,
    now,
  }: {
    organizationId: string;
    readerProjectId: string;
    now: number;
  }): Promise<SharedReadRow[]> {
    const { epochReader, cacheEnabled, sharedReads } = this.deps;
    const epoch =
      epochReader && cacheEnabled?.() === true
        ? await epochReader({ organizationId })
        : null;
    if (epoch === null) {
      return sharedReads.findLiveSharedReads({
        organizationId,
        readerProjectId,
      });
    }
    const key = `${organizationId}:${readerProjectId}`;
    const cached = this.sharedReadsCache.get(key);
    if (
      cached !== undefined &&
      cached.epoch === epoch &&
      now - cached.storedAt < SHARED_READS_CACHE_MAX_AGE_MS
    ) {
      return cached.rows;
    }
    const rows = await sharedReads.findLiveSharedReads({
      organizationId,
      readerProjectId,
    });
    this.sharedReadsCache.delete(key);
    if (this.sharedReadsCache.size >= SHARED_READS_CACHE_MAX_ENTRIES) {
      const oldest = this.sharedReadsCache.keys().next().value;
      if (oldest !== undefined) this.sharedReadsCache.delete(oldest);
    }
    this.sharedReadsCache.set(key, { epoch, rows, storedAt: now });
    return rows;
  }
}

/**
 * One shared grant per applicable row, and the earliest expiry among them
 * under the ceiling. A row that cannot be applied - a where clause, an
 * expired grant, the reader naming itself - is left out.
 */
function sharedGrantsFrom({
  rows,
  readerProjectId,
  permission,
  now,
}: {
  rows: SharedReadRow[];
  readerProjectId: string;
  permission: AuthzPermission;
  now: number;
}): { shared: AuthorizationGrant[]; expiresAt: number } {
  const shared: AuthorizationGrant[] = [];
  let expiresAt = now + AUTHORIZATION_MAX_AGE_MS;
  for (const row of rows) {
    const condition = proofCondition(row.condition);
    const expiry = row.expiresAt?.getTime();
    const applicable =
      row.memberProjectId !== readerProjectId &&
      condition !== undefined &&
      (expiry === undefined || expiry > now);
    if (!applicable) continue;
    shared.push({
      projectId: row.memberProjectId,
      permissions: [permission],
      via: [row.grantId],
      kind: "shared",
      condition,
    });
    if (expiry !== undefined) expiresAt = Math.min(expiresAt, expiry);
  }
  return { shared, expiresAt };
}

/**
 * The ledger stores ISO instants and keeps `where` as a slot; the proof
 * carries epoch milliseconds and only a window the client can apply. A
 * non-empty `where` has no compiler in v1, so the row stays out of the
 * proof rather than in it unfiltered. A window with no start stays out too:
 * the reconciler always writes one, and reading a missing start as the
 * epoch would open the widest window there is.
 */
function proofCondition(
  condition: GrantCondition,
): AuthorizationCondition | undefined {
  if (condition.where !== undefined && condition.where !== "") return undefined;
  if (condition.from === undefined) return undefined;
  const from = Date.parse(condition.from);
  const until =
    condition.until === undefined ? null : Date.parse(condition.until);
  if (Number.isNaN(from) || (until !== null && Number.isNaN(until))) {
    return undefined;
  }
  return { type: condition.type, from, until };
}

function proofPrincipal(
  principal: AuthzPrincipalRef,
): Authorization["principal"] {
  switch (principal.type) {
    case "user":
      return { type: "user", id: principal.id };
    case "apiKey":
      return { type: "apiKey", id: principal.id };
    case "anonymous":
      return { type: "anonymous" };
  }
}
