/**
 * ADR-166 / ADR-175: the door. `authorize` evaluates one permission on one project for one
 * principal and mints the sealed proof every read below the door carries by hand; nothing below
 * evaluates permissions again, the store client applies the proof.
 */
import {
  AccessNotGrantedError,
  type Actor,
  type Authorization,
  type AuthorizationCondition,
  type AuthorizationGrant,
  type AuthorizationPrincipal,
  type AuthorizationPurpose,
  type AuthzPermission,
  type PlatformActor,
  sealAuthorization,
} from "@langwatch/authorization";
import {
  AuthzScopeNotFoundError,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  builtinRoleGrants,
  type GrantCondition,
  PROJECT_READER_ROLE_KEY,
} from "@langwatch/authz-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import type {
  AuthzSharedReadRepository,
  SharedReadRow,
} from "../repositories/authz-shared-read.repository.ts";
import type { AuthzService } from "./authz.service.ts";

/** A proof never outlives this, whatever the grants say: how stale a route's view may be. */
export const AUTHORIZATION_MAX_AGE_MS = 5 * 60 * 1000;

/** How long a project's organisation is remembered for internal mints. */
const INTERNAL_SCOPE_CACHE_MS = 60 * 1000;

/** Bounds the internal-mint scope cache's memory; the oldest entry goes first. */
export const INTERNAL_SCOPE_CACHE_MAX_ENTRIES = 5_000;

/** Absolute ceiling on a cached shared-read lookup, epoch agreement or not, as the snapshot's. */
const SHARED_READS_CACHE_MAX_AGE_MS = 30_000;

/** Bounds the shared-read cache's memory; the oldest entry goes first. */
const SHARED_READS_CACHE_MAX_ENTRIES = 5_000;

type AuthorizationServiceOptions = Readonly<{
  permissions: Pick<AuthzService, "effectivePermissions" | "getScope">;
  sharedReads: Pick<AuthzSharedReadRepository, "findLiveSharedReads">;
  /** The organisation's epoch, bumped on every grant write; omitted, every mint reads afresh. */
  epoch?: Pick<AuthzEpochRepository, "findEpoch">;
  /** Internal rollout knob; omitted = cache off. The composition root supplies the read. */
  cacheEnabled?: () => boolean;
  now?: () => number;
}>;

type SharedReadsEntry = { epoch: number; rows: SharedReadRow[]; storedAt: number };

/** The door: evaluates a route's permission and mints the sealed proof its reads carry. */
export class AuthorizationService {
  static create(options: AuthorizationServiceOptions): AuthorizationService {
    return new AuthorizationService(options);
  }

  private readonly internalScopes = new Map<string, { organizationId: string; until: number }>();
  private readonly sharedReadsCache = new Map<string, SharedReadsEntry>();

  private constructor(private readonly options: AuthorizationServiceOptions) {}

  private now(): number {
    return this.options.now?.() ?? nowInstant().epochMilliseconds;
  }

  /**
   * The proof for platform code reading one project on its own behalf. No permission is
   * evaluated: the proof exists so the store client fences the read to the project named. The
   * own grant carries only the permission asked for, and there is never a shared grant.
   */
  async authorizeInternal({
    actor,
    projectId,
    permission,
    purpose,
  }: {
    actor: PlatformActor;
    projectId: string;
    permission: AuthzPermission;
    purpose: AuthorizationPurpose;
  }): Promise<Authorization> {
    const now = this.now();
    const organizationId = await this.organizationOf({ projectId, now });
    if (organizationId === undefined) throw new AccessNotGrantedError({ permission });
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

  /**
   * The proof for one route call: the own grant carries the caller's full effective set, each
   * shared grant the one permission the project-reader role confers. A permission the role does
   * not confer leaves shared grants out. An unknown project and a denial both read as not granted.
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
    const now = this.now();
    const scopeRef = await this.projectScopeOf({ projectId: scope.projectId });
    if (scopeRef?.type !== "project") throw new AccessNotGrantedError({ permission });
    // One engine pass: the effective set decides the permission and is what the own grant carries.
    const permissions = await this.options.permissions.effectivePermissions({
      principal,
      scope: scopeRef,
    });
    if (!permissions.includes(permission)) throw new AccessNotGrantedError({ permission });
    const own: AuthorizationGrant = {
      projectId: scope.projectId,
      permissions,
      via: [],
      kind: "own",
    };
    const rows = builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission })
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

  /** The project's scope, or undefined when no live project has the id. */
  private async projectScopeOf({
    projectId,
  }: {
    projectId: string;
  }): Promise<AuthzScopeRef | undefined> {
    try {
      return await this.options.permissions.getScope({ projectId });
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) return void 0;
      throw error;
    }
  }

  private async organizationOf({
    projectId,
    now,
  }: {
    projectId: string;
    now: number;
  }): Promise<string | undefined> {
    const cached = this.internalScopes.get(projectId);
    if (cached !== undefined && cached.until > now) return cached.organizationId;
    const scopeRef = await this.projectScopeOf({ projectId });
    if (scopeRef?.type !== "project") return void 0;
    this.internalScopes.delete(projectId);
    evictOldest({ cache: this.internalScopes, max: INTERNAL_SCOPE_CACHE_MAX_ENTRIES });
    this.internalScopes.set(projectId, {
      organizationId: scopeRef.organizationId,
      until: now + INTERNAL_SCOPE_CACHE_MS,
    });
    return scopeRef.organizationId;
  }

  /**
   * The reader's live shared reads, cached per organisation epoch (ADR-175). The epoch is read
   * before the rows, so a write landing between the two bumps past the entry. Expiry and the
   * reader naming itself are still applied per mint, so a cached row never outlives its grant.
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
    const { epoch: epochs, cacheEnabled, sharedReads } = this.options;
    const epoch =
      epochs && cacheEnabled?.() === true ? await epochs.findEpoch({ organizationId }) : null;
    if (epoch === null) return sharedReads.findLiveSharedReads({ organizationId, readerProjectId });
    const key = `${organizationId}:${readerProjectId}`;
    const cached = this.sharedReadsCache.get(key);
    if (
      cached !== undefined &&
      cached.epoch === epoch &&
      now - cached.storedAt < SHARED_READS_CACHE_MAX_AGE_MS
    ) {
      return cached.rows;
    }
    const rows = await sharedReads.findLiveSharedReads({ organizationId, readerProjectId });
    this.sharedReadsCache.delete(key);
    evictOldest({ cache: this.sharedReadsCache, max: SHARED_READS_CACHE_MAX_ENTRIES });
    this.sharedReadsCache.set(key, { epoch, rows, storedAt: now });
    return rows;
  }
}

/** Drops the oldest entry once the cache is full; a Map iterates in insertion order. */
function evictOldest({ cache, max }: { cache: Map<string, unknown>; max: number }): void {
  if (cache.size < max) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/**
 * One shared grant per applicable row, and the earliest expiry among them under the ceiling. A
 * row that cannot be applied (a where clause, an expired grant, the reader naming itself) is out.
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
    const condition = deriveProofCondition(row.condition);
    const expiry = row.expiresAt?.epochMilliseconds;
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
 * The ledger's ISO window as the proof's epoch milliseconds. A non-empty `where` has no compiler
 * yet, and a window with no start would open from the epoch, so either keeps the row out.
 */
function deriveProofCondition(condition: GrantCondition): AuthorizationCondition | undefined {
  if (condition.where !== undefined && condition.where !== "") return void 0;
  if (condition.from === undefined) return void 0;
  const from = parseEpochMs(condition.from);
  const until = condition.until === undefined ? null : parseEpochMs(condition.until);
  if (from === undefined || until === undefined) return void 0;
  return { type: condition.type, from, until };
}

/** An ISO instant as epoch milliseconds, or undefined when it does not parse. */
function parseEpochMs(iso: string): number | undefined {
  try {
    return Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return void 0;
  }
}

function proofPrincipal(principal: AuthzPrincipalRef): AuthorizationPrincipal {
  switch (principal.type) {
    case "user":
      return { type: "user", id: principal.id };
    case "apiKey":
      return { type: "apiKey", id: principal.id };
    case "anonymous":
      return { type: "anonymous" };
  }
}
