/**
 * ADR-092 §5, delivery-plan decision 25 — the tRPC adapter behind the typed
 * declaration surface. `protectedProcedure.input(…).permission("…")` compiles
 * down to the middleware built here.
 *
 * ONE seam, decision-neutral, properly layered: this middleware is the tRPC
 * boundary, it resolves `getApp().permissions` — the App-composed
 * `PermissionsService`, which takes the
 * `ForkAwarePermissionDecisionRepository`, which owns the client and
 * delegates to the same fork-aware resolvers the legacy
 * `checkXxxPermission` middlewares ran (`rbac.ts`) — so a not-yet-migrated
 * organization is decided by the legacy walk and a migrated one by the engine,
 * chosen by the organization's migration status alone. There is no shadow or
 * reverse-shadow comparison at request time (that path was removed with
 * `shadow.ts`); the fork is a plain if/else on the gate. Deploying the codemod
 * changes no decision anywhere; the contract PR later rewires only the
 * repository — one file, not four hundred call sites.
 *
 * What IS deliberately new here is the denial shape: every tier's refusal now
 * carries the engine's one handled code (`permission_denied`, with the
 * permission and tier in `meta`) where the legacy team/organization
 * middlewares shipped bare prose the client could only render as "unknown
 * error". Lite-member denials keep their dedicated cause — the client modal
 * keys on it.
 *
 * Every middleware built here carries an `AUTHZ_DECLARATION` descriptor, the
 * machine-readable half of the declaration: the sweep test walks the router
 * and refuses any procedure whose chain carries none.
 */
import {
  type AuthzDenialReason,
  type AuthzPermission,
  BlankScopeIdError,
  type DeclaredAuthzMiddleware,
  type DeclaredScopeId,
  declareAuthzMiddleware,
  PermissionDeniedError,
  resolveDeclaredScope,
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import type { Session } from "../../auth";
import { prisma } from "../../db";
import { type App, getApp } from "../app";
import { organizationMfa } from "../identity/runtime";
import { deploymentOffersTwoStepVerification } from "../identity/signin-method-policy";
import {
  LiteMemberRestrictedError,
  MembershipDisabledError,
} from "../permissions/errors";
import {
  permissionDecisionRecord,
  principalOfSession,
  recordPermissionDecision,
} from "./decision-record";
import {
  assertSecondFactorSatisfied,
  type MfaGateCache,
  type MfaGateDeps,
  newMfaGateCache,
} from "./mfa-gate";
import { PrismaScopeOwnership } from "./mfa-gate-adapters";

const logger = createLogger("langwatch:authz");

type ScopeInput = Partial<Record<ScopeTierField, unknown>>;

type MiddlewareParams = {
  ctx: {
    session: Session | null;
    /** The composed App the context factory injected (see `trpc.ts`). */
    app?: App;
    permissionChecked: boolean;
    organizationRole?: OrganizationUserRole | null;
    /**
     * The two-step verification gate's per-request memo (D06). A tRPC batch
     * shares one context, so this is what makes one person cost one query
     * across a dozen procedure calls rather than a dozen queries. Created on
     * first use — a context that never reaches a permission check never
     * allocates one.
     */
    mfaGateCache?: MfaGateCache;
    /** Injectable so a test can watch the gate without mocking a module. */
    mfaGate?: Partial<
      Pick<MfaGateDeps, "offered" | "scopes" | "organizationMfa">
    >;
  };
  input: ScopeInput;
  next: () => any;
};

/**
 * The gate's dependencies for this request: the flag, the scope lookup, the
 * organization service — and the memo that makes the whole thing cost one
 * query per person per request.
 */
const mfaGateDepsFor = (ctx: MiddlewareParams["ctx"]): MfaGateDeps => {
  ctx.mfaGateCache ??= newMfaGateCache();
  return {
    offered: ctx.mfaGate?.offered ?? deploymentOffersTwoStepVerification,
    scopes: ctx.mfaGate?.scopes ?? new PrismaScopeOwnership(prisma),
    organizationMfa: ctx.mfaGate?.organizationMfa ?? organizationMfa,
    cache: ctx.mfaGateCache,
  };
};

/**
 * The App this request decides through: the one its context factory injected,
 * or the process singleton for contexts built without one (SSG helpers,
 * embedded callers). Both are the same instance in production — the ctx slot
 * exists so a test can hand in a fake without mocking the App module.
 */
const appOf = (ctx: MiddlewareParams["ctx"]): App => ctx.app ?? getApp();

type DeclaredMiddleware = DeclaredAuthzMiddleware<
  (params: MiddlewareParams) => Promise<any>
>;

/**
 * `.permission(p)` / `.permission(p, { via })`. The type layer
 * (`@langwatch/authz` declaration.ts + the builder in `api/trpc.ts`)
 * guarantees the input carries a usable id; the runtime re-derives the same
 * answer and still fails loudly if the two ever disagree.
 */
export const checkDeclaredPermission = ({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "permission", permission, via },
    async ({ ctx, input, next }: MiddlewareParams) => {
      // `publicProcedure` exposes `.permission()` too, so a session is not a
      // given. Answering "unauthenticated" before any id is looked at keeps
      // an anonymous caller from learning anything about the scope.
      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const scope = requireDeclaredScope({ permission, input, via });
      const { permitted, organizationRole, denialReason } = await appOf(
        ctx,
      ).permissions.getDecision({
        userId: ctx.session.user.id,
        permission,
        scope,
      });

      // D06: both people, on every decision. Under an impersonation the actor
      // is the operator and the subject is the person whose access they are
      // borrowing, so the audit trail can answer who really did it. On every
      // other request the two halves are the same person and it says so.
      recordPermissionDecision(
        permissionDecisionRecord({
          principal: principalOfSession({ session: ctx.session }),
          permission,
          scope,
          permitted,
          denialReason,
        }),
      );

      if (!permitted) {
        throw deniedError({
          permission,
          scope,
          organizationRole,
          denialReason,
        });
      }

      // D06 follow-up 2: the organization's membership condition, enforced
      // rather than merely offered. Runs AFTER the permission, so somebody
      // who has no business here is refused for that reason rather than sent
      // to set up a second factor they would still be refused with. With
      // `MFA_ENROLLMENT_OPEN` off this is a boolean and a return.
      await assertSecondFactorSatisfied({
        deps: mfaGateDepsFor(ctx),
        userId: ctx.session.user.id,
        sessionId: ctx.session.sessionId,
        scope,
      });

      // Legacy parity: the organization tier never carried a role onto the
      // context, so only the project/team resolutions (non-null role) do.
      if (organizationRole !== null) {
        ctx.organizationRole = organizationRole;
      }

      ctx.permissionChecked = true;
      return next();
    },
  );

/**
 * `.permissionAny(…)` — any one of the permissions is enough, checked at the
 * input's project scope. One scope resolution serves every candidate; the
 * denial names the FIRST permission, so callers list the primary surface
 * first (granting it resolves the refusal whichever feature the caller came
 * through).
 */
export const checkDeclaredPermissionAny = (
  permissions: readonly [AuthzPermission, ...AuthzPermission[]],
): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "permission-any", permissions },
    async ({ ctx, input, next }: MiddlewareParams) => {
      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      // Always the project tier, so the field is named outright — but read
      // through the same resolution the single-permission seam uses, so the
      // blank-versus-missing split is decided in exactly one place.
      const { id: projectId } = requireDeclaredScope({
        permission: permissions[0],
        input,
        via: "projectId",
      });
      const { permitted, organizationRole, denialReason } = await appOf(
        ctx,
      ).permissions.getProjectAnyDecision({
        userId: ctx.session.user.id,
        projectId,
        permissions,
      });

      const scope = { tier: "project", id: projectId } as const;

      // The same two things the single-permission seam does, and for the same
      // reasons — "any one of these" is a different question about the same
      // access, not a lighter one.
      //
      // D06 says both people on EVERY decision. A decision made under an
      // impersonation through this branch named nobody, which is the one
      // place the trail is supposed to answer who really did it.
      recordPermissionDecision(
        permissionDecisionRecord({
          principal: principalOfSession({ session: ctx.session }),
          permission: permissions[0],
          scope,
          permitted,
          denialReason,
        }),
      );

      if (!permitted) {
        throw deniedError({
          permission: permissions[0],
          scope,
          organizationRole,
          denialReason,
        });
      }

      // And the organization's membership condition. Without it a member who
      // could not prove a second factor was refused by every `.permission()`
      // procedure and then reached the same organization's data through a
      // `.permissionAny()` one.
      await assertSecondFactorSatisfied({
        deps: mfaGateDepsFor(ctx),
        userId: ctx.session.user.id,
        sessionId: ctx.session.sessionId,
        scope,
      });

      ctx.organizationRole = organizationRole;
      ctx.permissionChecked = true;
      return next();
    },
  );

const SENSITIVE_SCOPE_FIELDS = Object.values(
  SCOPE_TIER_FIELDS,
) as ScopeTierField[];

/**
 * `.noPermission({ reason, allow })` — authenticated, deliberately
 * unchecked. The type layer refuses scoped input fields that are not
 * individually allowed with a reason; this runtime guard is the defense in
 * depth behind it, unchanged in behaviour from the legacy
 * `skipPermissionCheck`.
 */
export const declaredNoPermission = ({
  reason,
  allow,
}: {
  reason: string;
  allow?: Record<string, string>;
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "no-permission", reason, allow },
    async ({ ctx, input, next }: MiddlewareParams) => {
      const allowedKeys = Object.keys(allow ?? {});
      // A procedure that declares no `.input()` arrives here with `undefined`,
      // and `in` throws on it — which turned every such procedure into a 500
      // at the boundary rather than a call (`identity.myIdentifiers` was one).
      // Nothing is skipped by this: an input that does not exist carries no
      // scope field to smuggle past the check.
      const declaredInput =
        typeof input === "object" && input !== null ? input : {};
      for (const key of SENSITIVE_SCOPE_FIELDS) {
        if (key in declaredInput && !allowedKeys.includes(key)) {
          throw new Error(
            `${key} is not allowed to be used without permission check`,
          );
        }
      }

      // NO PERMISSION IS NOT NO CONDITION. These procedures are deliberately
      // unchecked for permission — the reason is declared and reviewed — but
      // an organization that requires a second factor requires it of anybody
      // reaching its data, and this branch reaches it by an ALLOWED scope
      // field. Without this, a member who could not prove one was refused by
      // every `.permission()` procedure and then minted a durable API key for
      // the same organization through `apiKey.create`.
      if (ctx.session?.user) {
        for (const key of allowedKeys) {
          const named = (declaredInput as Record<string, unknown>)[key];
          const tier = SCOPE_TIER_BY_FIELD[key as ScopeTierField];
          if (tier === undefined || typeof named !== "string" || !named) {
            continue;
          }
          await assertSecondFactorSatisfied({
            deps: mfaGateDepsFor(ctx),
            userId: ctx.session.user.id,
            sessionId: ctx.session.sessionId,
            scope: { tier, id: named },
          });
        }
      }

      ctx.permissionChecked = true;
      return next();
    },
  );

/**
 * `.authorizeInService({ reason, permissions })` — the scope is data the
 * handler loads at runtime, so the SERVICE performs the real authorization
 * and the declaration records which permissions it enforces. This only moves
 * WHERE the check happens, never whether one does.
 */
export const declaredServiceAuthorization = ({
  reason,
  permissions,
}: {
  reason: string;
  permissions: readonly AuthzPermission[];
}): DeclaredMiddleware =>
  declareAuthzMiddleware(
    { kind: "service-authorized", reason, permissions },
    async ({ ctx, next }: MiddlewareParams) => {
      ctx.permissionChecked = true;
      return next();
    },
  );

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzPermission;
  input: ScopeInput;
  via?: ScopeTierField;
}): DeclaredScopeId {
  const resolution = resolveDeclaredScope({ permission, input, via });
  if (resolution.resolved) return resolution.scope;
  if (resolution.unresolved.reason === "blank") {
    throw blankScopeId({ field: resolution.unresolved.field });
  }
  throw wiringBug({ permission, via });
}

/**
 * The caller named the scope field and left it empty. Answered as the bad
 * request it is, rather than as the wiring bug below: a blank id is something
 * the caller can fix, and reporting it as an internal error both misleads them
 * and pages us for their typo.
 */
function blankScopeId({ field }: { field: string }): TRPCError {
  const blank = new BlankScopeIdError({ field });
  return new TRPCError({
    code: "BAD_REQUEST",
    message: blank.message,
    cause: blank,
  });
}

/**
 * The input names no scope field at all. Nothing the caller did can fix that,
 * so the sentence they read says only that; which procedure is miswired goes
 * to the log. The types make this unreachable — this is the runtime backstop
 * for the day they are bypassed.
 *
 * A field that is present and empty is NOT this: the types only ever promised
 * the field would exist, never that a caller would fill it, and treating a
 * blank id as a wiring bug is what put a routine bad request on the error
 * dashboard at ERROR severity. That case answers through `blankScopeId`.
 */
function wiringBug({
  permission,
  via,
}: {
  permission: AuthzPermission;
  via?: ScopeTierField;
}): TRPCError {
  logger.error(
    { permission, via },
    "declared permission's input carries no usable scope id",
  );
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Please try again.",
  });
}

/**
 * The one denial shape for every tier. An id that resolves to nothing
 * answers exactly like an id the caller may not touch — the resolvers
 * already fold both into `permitted: false`, so no probe can learn whether a
 * scope EXISTS. The lite-member cause drives the client's restriction modal;
 * the `PermissionDeniedError` cause carries the stable code and meta for
 * everything else.
 */
function deniedError({
  permission,
  scope,
  organizationRole,
  denialReason,
}: {
  permission: AuthzPermission;
  scope: DeclaredScopeId;
  organizationRole: OrganizationUserRole | null;
  denialReason?: AuthzDenialReason;
}): TRPCError {
  // Checked before the role, because a disabled member HAS a role and the
  // role-shaped answers would all be wrong for them: the lite-member modal
  // offers an upgrade they cannot buy, and the generic denial names a
  // permission nobody can grant them while the seat is off.
  if (denialReason === "membership-disabled") {
    const disabled = new MembershipDisabledError();
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: disabled.message,
      cause: disabled,
    });
  }
  // String comparison on purpose: a VALUE import of the Prisma enum would put
  // the generated client on this module's graph for one constant.
  if (organizationRole === "EXTERNAL") {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "This feature is not available for your account",
      cause: new LiteMemberRestrictedError(
        permission.split(":")[0] ?? "unknown",
      ),
    });
  }
  const denied = new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: denialReason ?? "no-binding",
  });
  // The wire code that results is FORBIDDEN, not the UNAUTHORIZED spelled
  // here: `handledErrorMiddleware` re-derives it from the handled cause's
  // `httpStatus` (403) — the caller IS authenticated, they just lack the
  // permission.
  return new TRPCError({
    code: "UNAUTHORIZED",
    message: denied.message,
    cause: denied,
  });
}
