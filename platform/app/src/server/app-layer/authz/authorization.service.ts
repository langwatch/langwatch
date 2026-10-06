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
  AuthzService,
  GrantCondition,
} from "@langwatch/authz-server";
import type { SharedReadsGrantsRepository } from "./repositories/shared-reads.grants.repository";

/** A proof never outlives this, whatever the grants say: the ceiling on
 *  how stale a route's view of access may be. */
export const AUTHORIZATION_MAX_AGE_MS = 5 * 60 * 1000;

export type AuthorizationServiceDeps = {
  authz: Pick<AuthzService, "checkDetailed" | "effectivePermissions">;
  collector: Pick<AuthzCollectorService, "resolveScopeRef">;
  sharedReads: Pick<SharedReadsGrantsRepository, "findLiveSharedReads">;
  now?: () => number;
};

export class AuthorizationService {
  constructor(private readonly deps: AuthorizationServiceDeps) {}

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
    const { authz, collector, sharedReads } = this.deps;
    const now = this.deps.now?.() ?? Date.now();

    const scopeRef = await collector.resolveScopeRef({
      projectId: scope.projectId,
    });
    if (!scopeRef || scopeRef.type !== "project") {
      throw new AccessNotGrantedError(permission);
    }
    const { decision } = await authz.checkDetailed({
      principal,
      permission,
      scope: scopeRef,
    });
    if (!decision.allowed) throw new AccessNotGrantedError(permission);

    const permissions = await authz.effectivePermissions({
      principal,
      scope: scopeRef,
    });
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
      ? await sharedReads.findLiveSharedReads({
          organizationId: scopeRef.organizationId,
          readerProjectId: scope.projectId,
        })
      : [];
    const shared: AuthorizationGrant[] = [];
    let expiresAt = now + AUTHORIZATION_MAX_AGE_MS;
    for (const row of rows) {
      if (row.memberProjectId === scope.projectId) continue;
      const condition = proofCondition(row.condition);
      if (!condition) continue;
      if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
      shared.push({
        projectId: row.memberProjectId,
        permissions: [permission],
        via: [row.grantId],
        kind: "shared",
        condition,
      });
      if (row.expiresAt) {
        expiresAt = Math.min(expiresAt, row.expiresAt.getTime());
      }
    }

    return sealAuthorization({
      actor,
      principal: proofPrincipal(principal),
      scope: { organizationId: scopeRef.organizationId },
      grants: [own, ...shared],
      expiresAt,
      purpose,
    });
  }
}

/**
 * The ledger stores ISO instants and keeps `where` as a slot; the proof
 * carries epoch milliseconds and only a window the client can apply. A
 * non-empty `where` has no compiler in v1, so the row stays out of the
 * proof rather than in it unfiltered.
 */
function proofCondition(
  condition: GrantCondition,
): AuthorizationCondition | undefined {
  if (condition.where !== undefined && condition.where !== "") return undefined;
  const from = condition.from === undefined ? 0 : Date.parse(condition.from);
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
