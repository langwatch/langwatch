import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { PrismaClient } from "~/generated/prisma/client";
import { batchProjectPermissions, type Permission } from "~/server/api/rbac";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { LANGY_SESSION_API_KEY_NAME } from "~/server/api-key/reserved-names";
import type { Session } from "~/server/auth";
import { getLangySessionKeysCounter } from "~/server/metrics";
import { langyCandidatePermissions } from "./langyPermissionPolicy";

const logger = createLogger("langwatch:langy:api-key");
const tracer = getLangWatchTracer("langwatch.langy.api-key");

// The full surface the Langy assistant could ever exercise — the CANDIDATE
// set. `mintLangySessionApiKey` (the per-chat key) grants only the INTERSECTION
// of this list with what the requesting user actually holds, so a tool call can
// never exceed the human who triggered it. (The old eager per-project service
// key that also drew from this list is gone — the per-turn session key fully
// supersedes it.)
//
// THAT INTERSECTION IS THE REAL SAFETY PROPERTY, and it is worth being precise
// about what it does and does not buy, because this list was kept narrow for a
// long time on the theory that it was the last line of defence. It is not. A
// user who cannot delete a dataset by hand cannot ask Langy to delete one:
// `batchProjectPermissions` resolves every candidate below against the caller
// and drops the ones they do not hold. Widening this list widens the CEILING,
// never anybody's actual access.
//
// What the intersection does NOT bound is the axes where "the user could have
// done it too" stops being reassuring — publishing a PUBLIC trace link, rotating
// a live credential, reading a stored secret. Those are withheld in
// `langyPermissionPolicy.ts`, which is where the reasoning now lives.
//
// DERIVED, NOT HAND-MAINTAINED. This used to be a hand-written enumeration of
// 27 lines, and the gap between it and the rule it was meant to express put the
// same 403 in front of users three times — `project:view`, `scenarios:create`,
// `experiments:view` — each one a line nobody remembered to add. The rule and
// the list can no longer disagree, because there is only one of them now.
//
// THE OTHER HALF OF THIS CONTRACT IS STILL THE ROUTE. A permission granted here
// is worthless unless the endpoint asks for a grain the key holds: `POST
// /api/scenarios` once required `scenarios:manage`, so a key holding exactly
// `scenarios:create` was refused at the door. Langy now holds `:manage` on the
// data families, so that class of over-gating no longer locks it out — but the
// routes are still over-gated for every OTHER restricted key, and
// `langy-permission-coverage` is what keeps the two halves honest. When a Langy
// write is refused, check the route's `requires(...)` before touching policy.
export const LANGY_CANDIDATE_PERMISSIONS: readonly Permission[] = Object.freeze(
  langyCandidatePermissions(),
);
// A leaked Langy session key auto-expires after this window. Sized to comfortably
// outlast a single chat turn / worker idle lifetime (the worker is short-lived)
// while keeping the blast radius of a leak small. Tune alongside the worker's
// idle lifetime — this is a ceiling, not a lease that gets renewed mid-chat.
const LANGY_SESSION_KEY_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Mints a session key for a caller we know only by user id.
 *
 * This is the RETRY path. The manager told us it must spawn a worker but the turn
 * arrived with no key (the worker died between our probe and the turn). By then we
 * are in the turn processor, far from the browser session that started this — all
 * we have is the actor's user id, off the handoff.
 *
 * Rehydrating a session object from that id grants NOTHING. Every permission
 * decision `mintLangySessionApiKey` makes is resolved against the database:
 * `probeProjectPermission` reads `session.user.id` and looks up the rest. So the
 * minted key is still exactly the intersection of what this user genuinely holds.
 * We are re-stating WHO the caller is, never asserting what they may do.
 */
export async function mintLangySessionApiKeyForUser({
  prisma,
  userId,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  userId: string;
  projectId: string;
  organizationId: string;
}): Promise<{ token: string; apiKeyId: string }> {
  // RBAC's contract is `session.user.id` and nothing more — verified against
  // resolveProjectPermission, which takes every other fact from Postgres.
  const session = { user: { id: userId } } as unknown as Session;
  return mintLangySessionApiKey({ prisma, session, projectId, organizationId });
}

/** Outcome of a system revocation. `refused` means "that was not ours to touch". */
export type LangySessionKeyRevocation =
  | "revoked"
  | "already_revoked"
  | "not_found"
  | "refused";

/**
 * Revokes a Langy session key on behalf of the AGENT MANAGER, which reports a
 * worker's death so the key that died with it stops being a live credential.
 *
 * This is deliberately NOT `ApiKeyService.revoke`: that one is the human path and
 * asks "is the caller an admin, or the key's owner?" The manager is neither — it
 * is a service with no user identity, and answering that question by handing it a
 * synthetic admin would give it the power to revoke ANY key in the org. So the
 * authority here is narrowed to the only thing the manager should ever be able to
 * destroy:
 *
 *   - It can revoke ONLY keys named LANGY_SESSION_API_KEY_NAME. Anything else —
 *     a user's personal key, the shared project key, an ingestion key — is
 *     REFUSED, even with a valid internal secret and a real key id. A manager
 *     that is compromised, confused, or fed a bad id cannot use this to take a
 *     customer's API keys offline.
 *   - It is TENANT-SCOPED: the key must belong to `projectId` (the tenant the
 *     turn ran for, which the manager holds on the worker's credentials). The
 *     session key is minted with a PROJECT-scoped role binding, so this is the
 *     project it was scoped to. Without it, a bearer-secret holder could look a
 *     key up by id alone and revoke ANY tenant's live session key — the id is
 *     the only thing gating it otherwise. `not_found` when the key exists but
 *     under a different project, so the response never confirms a cross-tenant
 *     id.
 *   - It can only revoke. There is no minting counterpart, by design: revocation
 *     is fail-closed (the worst outcome is the manager destroying its own
 *     access), whereas a mint endpoint would let whoever holds the internal
 *     secret manufacture credentials for any user they can name.
 *
 * Idempotent: a key already revoked is a success, because a caller retrying is
 * asking for a state that already holds. The manager also races the reaper, so
 * "already gone" must never look like a fault.
 */
export async function revokeLangySessionApiKey({
  prisma,
  apiKeyId,
  projectId,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  projectId: string;
}): Promise<LangySessionKeyRevocation> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      id: true,
      name: true,
      revokedAt: true,
      // The PROJECT-scoped binding the session key is minted with is the
      // tenant anchor: a match proves this key belongs to the calling turn's
      // project, not some other tenant's.
      roleBindings: {
        where: { scopeType: "PROJECT", scopeId: projectId },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!key) return "not_found";

  // Fail closed. The name is the ONLY thing that makes a key ours to revoke.
  if (key.name !== LANGY_SESSION_API_KEY_NAME) {
    logger.warn(
      { apiKeyId, name: key.name },
      "refusing to revoke a key that is not a Langy session key",
    );
    return "refused";
  }

  // Tenant scope: the key exists and is a session key, but it is not this
  // project's. Report not-found so a cross-tenant id is never confirmed.
  if (key.roleBindings.length === 0) {
    logger.warn(
      { apiKeyId, projectId },
      "refusing to revoke a langy session key that is not scoped to this project",
    );
    return "not_found";
  }

  if (key.revokedAt) return "already_revoked";

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { revokedAt: new Date() },
  });
  getLangySessionKeysCounter("revoked").inc();
  return "revoked";
}

/**
 * Revokes every Langy session key whose lifetime has elapsed.
 *
 * THIS IS THE GUARANTEE, and revocation-on-worker-death is only the fast path.
 * The manager revokes a key when it sees a worker die — but a manager that is
 * SIGKILLed (OOM, node eviction, force-delete) sees nothing and runs no cleanup,
 * and every key its workers held then stays valid for the rest of its TTL. No
 * callback can close that hole, because the process that would make the call is
 * the one that died.
 *
 * So the reaper is not redundant with revoke-on-death; it is the backstop that
 * makes the whole scheme safe, and deleting it would reintroduce exactly the
 * long tail of live, orphaned credentials this work set out to remove.
 *
 * Returns the number of keys revoked so the caller can log/meter it — a number
 * that stays stubbornly high means workers are dying without their manager
 * noticing, which is worth knowing.
 */
export async function reapExpiredLangySessionApiKeys({
  prisma,
  now = new Date(),
}: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<number> {
  const { count } = await prisma.apiKey.updateMany({
    where: {
      name: LANGY_SESSION_API_KEY_NAME,
      revokedAt: null,
      expiresAt: { not: null, lte: now },
    },
    data: { revokedAt: now },
  });
  if (count > 0) {
    // Reaped keys mean revoke-on-worker-death missed — a small steady rate is
    // normal (SIGKILLed managers), a jump means the fast path is broken.
    getLangySessionKeysCounter("reaped").inc(count);
    logger.info({ count }, "reaped expired langy session keys");
  }
  return count;
}

/**
 * Thrown when the requesting user holds NONE of the permissions Langy can use
 * in the project, so there is no non-empty least-privilege key to mint. Carries
 * a user-safe message; the credential service surfaces it as a 409/403 to the
 * chat route rather than letting the caller fall back to a broader key.
 */
export class LangySessionKeyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangySessionKeyScopeError";
  }
}

/**
 * Mints an ephemeral, per-chat-session Langy API key SCOPED TO THE REQUESTING
 * USER'S OWN PERMISSIONS, and returns its plaintext token.
 *
 * Why this exists — and why it replaces the shared "Langy" service key at chat
 * time:
 *   - OWNED BY THE USER (`userId = session.user.id`). ApiKeyService.create then
 *     runs `assertBindingsWithinCeiling` against that user, so the key's ceiling
 *     IS the human. A Langy tool call therefore can never exceed what the user
 *     could do by hand — even though the old shared service key was
 *     admin-equivalent on 9 resource families for anyone past the coarse gate.
 *   - LEAST PRIVILEGE. We request only the HELD SUBSET: the intersection of the
 *     Langy candidate permissions with the ones this user actually holds at the
 *     project scope. Because every requested permission is one the user holds,
 *     `assertBindingsWithinCeiling` never throws a scope violation.
 *   - EPHEMERAL (`expiresAt` a few hours out). A leaked session key auto-expires,
 *     so the blast radius is small in both breadth (the user's own access) and
 *     time.
 *
 * Identity source: this keys off the CALLER'S user identity, not a browser
 * session per se — it only reads `session.user.id` (to own the key) and passes
 * the session to `probeProjectPermission` (to intersect the caller's own
 * permissions). Langy chat is session-gated today, so `session` always comes
 * from a logged-in user. If/when Langy is exposed to programmatic (API-key)
 * callers, the route resolves the API key to its owning user and passes THAT
 * identity here unchanged — the own-the-user + intersect-permissions logic is
 * identical regardless of how the caller authenticated. Nothing here assumes a
 * browser session beyond the user id.
 *
 * Throws `LangySessionKeyScopeError` when the held subset is empty — a user with
 * zero Langy-relevant permissions must not receive a key at all.
 */
export async function mintLangySessionApiKey({
  prisma,
  session,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  session: Session;
  projectId: string;
  organizationId: string;
  // The id is returned alongside the token because it is the ONLY handle the
  // agent manager gets: it names the key for revocation when the worker dies,
  // without granting anything. The token itself is unrecoverable after this call
  // (only its hash is stored), which is exactly why the key's lifetime has to be
  // managed by whoever holds it — the worker — rather than re-derived later.
}): Promise<{ token: string; apiKeyId: string }> {
  // Held subset = the intersection of the Langy candidate permissions with the
  // permissions this user actually holds at the project scope. `:manage` implies
  // `:view/:create/:update` via the rbac hierarchy, but `:update` does NOT imply
  // `:view/:create`, so each candidate must be decided individually.
  //
  // ONE batched resolution, not 27 scoped checks. This is a CORRECTNESS fix, not
  // a speed-up, and the history is worth keeping:
  //
  //   - Originally: `await hasProjectPermission(...)` inside a `for` loop over 27
  //     candidates. Each check costs ~3 queries, so ~81 SERIALIZED round-trips on
  //     every chat turn — 500-600ms, on a comment that claimed chat "is not
  //     hot-path traffic".
  //   - Then: the same 27 checks under `Promise.all`. Faster in a quiet trace
  //     (~15ms), and WORSE where it counted: 81 queries now wanted 81 Prisma
  //     connections AT ONCE. Under real concurrency that starved the pool, and the
  //     interactive transaction inside `ApiKeyService.create` below — which has a
  //     5-second budget — could not get a connection and ABORTED. The turn died
  //     with a 409 after ~90 seconds. Making the queries faster did not make them
  //     safe; there were simply too many of them.
  //   - Now: `batchProjectPermissions` loads the permission-INDEPENDENT facts once
  //     (org membership, group memberships, role bindings, custom roles, the legacy
  //     TeamUser fallback) and decides all 27 candidates in memory. ~4 queries,
  //     flat, no matter how long the candidate list grows.
  //
  // Order is preserved, so `heldPermissions` is deterministic.
  const heldPermissions: Permission[] = await tracer.withActiveSpan(
    "langy.mint.permission_probes",
    {
      attributes: {
        "tenant.id": projectId,
        // Candidates is the width of the question; the query count no longer
        // scales with it. If these ever diverge again, this span is where it shows.
        "langy.permission.candidates": LANGY_CANDIDATE_PERMISSIONS.length,
      },
    },
    async (span) => {
      // The project's team, because a TEAM-scoped binding inherits down to its
      // projects. `hasProjectPermission` used to look this up inside every one of
      // the 27 checks; once is enough.
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      });

      const held = await batchProjectPermissions(
        { prisma, session },
        {
          organizationId,
          projectId,
          ...(project?.teamId ? { teamId: project.teamId } : {}),
          permissions: [...LANGY_CANDIDATE_PERMISSIONS],
        },
      );
      span.setAttribute("langy.permission.held", held.length);
      return held;
    },
  );

  if (heldPermissions.length === 0) {
    throw new LangySessionKeyScopeError(
      "You do not hold any of the permissions Langy needs in this project, " +
        "so no Langy session key could be created for you.",
    );
  }

  const service = ApiKeyService.create(prisma);
  // Its own span: this is the INSERT (plus the ceiling check). Separating it from
  // the probes above is the point — a fat `mint` span tells you nothing, but
  // "probes 40ms / insert 8ms" tells you exactly which half to attack. It also
  // makes the per-turn row churn visible in the trace: one of these per turn.
  const { token, apiKey } = await tracer.withActiveSpan(
    "langy.mint.create_api_key",
    {
      attributes: {
        "tenant.id": projectId,
        "langy.permission.granted": heldPermissions.length,
      },
    },
    async () =>
      service.create({
        // Reserved name — hidden from the API-keys UI so per-session keys don't
        // clutter the list (see HIDDEN_SYSTEM_KEY_NAMES). `isSystemManaged` is
        // what lets this path claim the name customer entry points are
        // refused.
        isSystemManaged: true,
        name: LANGY_SESSION_API_KEY_NAME,
        description:
          "Ephemeral per-session key for the Langy assistant. Mirrors your own " +
          "permissions in this project and auto-expires — revoked automatically " +
          "when it lapses.",
        // OWNED by the requesting user → their permissions are the ceiling.
        userId: session.user.id,
        createdByUserId: session.user.id,
        organizationId,
        permissionMode: "restricted",
        permissions: heldPermissions,
        bindings: [
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId },
        ],
        expiresAt: new Date(Date.now() + LANGY_SESSION_KEY_TTL_MS),
      }),
  );

  getLangySessionKeysCounter("minted").inc();
  return { token, apiKeyId: apiKey.id };
}
