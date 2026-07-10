import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Session } from "~/server/auth";
import { hasProjectPermission, type Permission } from "~/server/api/rbac";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { LANGY_SESSION_API_KEY_NAME } from "~/server/api-key/reserved-names";
import { decrypt, encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";
import { resolveAttributionUserId } from "./langyAttribution";

const logger = createLogger("langwatch:langy:api-key");

export const LANGY_API_KEY_NAME = "Langy";

// ProjectSecret name under which the dedicated Langy key's one-time token is
// stored (encrypted). The ApiKey row only keeps a hash of the secret, so the
// usable token MUST be captured at mint time for the runtime (the worker's MCP
// server) to retrieve it later — same pattern as the Langy virtual key.
export const LANGY_API_KEY_SECRET_NAME = "langy_api_key_secret";

// The full surface the Langy assistant could ever exercise — the CANDIDATE
// set. Two keys draw from it:
//
//   - `provisionLangyApiKey` (the eager project-create key) grants this whole
//     list as a service key.
//   - `mintLangySessionApiKey` (the per-chat key) grants only the INTERSECTION
//     of this list with what the requesting user actually holds, so a tool
//     call can never exceed the human who triggered it.
//
// Hand-rolled rather than derived from `computePermissionsFromSelections(...)`
// because the category system's `"write"` level is too coarse for this key:
//
//   - For non-traces resources, `"write"` expands to `[:view, :manage]` and
//     `:manage` includes `:delete` via the hierarchy in rbac.ts. The Langy
//     assistant must never be able to delete a user's prompts/datasets/etc.
//   - For traces, `"write"` includes `:share`, which creates PUBLIC trace
//     links. Langy doesn't need to expose user traces; the share endpoint is
//     a separate user-driven UI affordance.
//   - `cost:read` was previously included but Langy doesn't need cost data
//     to do its job — it surfaces spend data only via gateway-emitted
//     telemetry on the conversation's own messages, never via the key.
//
// Each resource lists exactly `:view, :create, :update` across the 9 Langy
// resource families — enough for MCP tools to read, create, and edit data, but
// stopping short of delete/manage/share. The per-session key never grants more
// than the caller holds; this list only bounds the maximum surface Langy tools
// can ever touch.
const LANGY_CANDIDATE_PERMISSIONS: Permission[] = [
  "traces:view",
  "traces:create",
  "traces:update",
  "evaluations:view",
  "evaluations:create",
  "evaluations:update",
  "datasets:view",
  "datasets:create",
  "datasets:update",
  "scenarios:view",
  "scenarios:create",
  "scenarios:update",
  "annotations:view",
  "annotations:create",
  "annotations:update",
  "analytics:view",
  "analytics:create",
  "analytics:update",
  "prompts:view",
  "prompts:create",
  "prompts:update",
  "triggers:view",
  "triggers:create",
  "triggers:update",
  "workflows:view",
  "workflows:create",
  "workflows:update",
];

/**
 * Returns the decrypted, ready-to-use dedicated Langy key token for a project,
 * or null if it hasn't been provisioned yet. This is the token the worker's MCP
 * server uses as LANGWATCH_API_KEY.
 */
export async function getLangyApiKeyToken({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string | null> {
  // findFirst with an explicit `projectId` (NOT findUnique-by-`projectId_name`):
  // the request-scoped prisma client runs a multitenancy guard that recognizes a
  // plain `projectId` predicate but NOT the `projectId_name` compound key, and
  // would otherwise throw "requires a 'projectId' in the where clause". This is
  // why the creation-hook mint silently failed under ctx.prisma. ProjectSecret is
  // unique on (projectId, name), so this still returns exactly the one row.
  const secret = await prisma.projectSecret.findFirst({
    where: { projectId, name: LANGY_API_KEY_SECRET_NAME },
    select: { encryptedValue: true },
  });
  return secret ? decrypt(secret.encryptedValue) : null;
}

/**
 * Mints the dedicated Langy key for a project — a service key (no human owner),
 * named "Langy", restricted to a least-privilege permission set, bound to the
 * project scope only — AND stores its one-time token (encrypted) so the runtime
 * can hand it to the worker.
 *
 * Idempotent: a no-op once the usable token is stored. The "provisioned" gate is
 * the stored token (not just the ApiKey row), because a key whose token wasn't
 * captured is useless to the worker.
 */
export async function provisionLangyApiKey({
  prisma,
  projectId,
  organizationId,
  createdByUserId = null,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
  createdByUserId?: string | null;
}): Promise<void> {
  if (await getLangyApiKeyToken({ prisma, projectId })) return;

  const creatorId = await resolveAttributionUserId({
    prisma,
    organizationId,
    explicitUserId: createdByUserId,
  });
  if (!creatorId) {
    logger.warn(
      { projectId },
      "no user to attribute the Langy key token to; skipping — chat will 409 until a member with permissions can attribute the key",
    );
    return;
  }

  const service = ApiKeyService.create(prisma);
  const { token } = await service.create({
    name: LANGY_API_KEY_NAME,
    description:
      "Dedicated key for the Langy in-product assistant. Scoped to this project; revoke to cut off Langy's access.",
    userId: null, // service key — owned by no individual user
    createdByUserId: creatorId,
    organizationId,
    permissionMode: "restricted",
    permissions: LANGY_CANDIDATE_PERMISSIONS,
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
  });

  try {
    await prisma.projectSecret.create({
      data: {
        projectId,
        name: LANGY_API_KEY_SECRET_NAME,
        encryptedValue: encrypt(token),
        createdById: creatorId,
        updatedById: creatorId,
      },
    });
  } catch (error) {
    // Race: another provision stored the token first. The key we just minted is
    // an orphan (harmless, revocable later); the winner's stored token is the
    // authoritative one. Acceptable for v1.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

// A leaked Langy session key auto-expires after this window. Sized to comfortably
// outlast a single chat turn / worker idle lifetime (the worker is short-lived)
// while keeping the blast radius of a leak small. Tune alongside the worker's
// idle lifetime — this is a ceiling, not a lease that gets renewed mid-chat.
const LANGY_SESSION_KEY_TTL_MS = 6 * 60 * 60 * 1000; // 6h

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
 * the session to `hasProjectPermission` (to intersect the caller's own
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
}): Promise<string> {
  // Held subset = the intersection of the Langy candidate permissions with the
  // permissions this user actually holds at the project scope. `:manage` implies
  // `:view/:create/:update` via the rbac hierarchy, but `:update` does NOT imply
  // `:view/:create`, so we must probe each candidate individually rather than
  // assume a role grants the whole family. Sequential (not Promise.all) —
  // chat is not hot-path traffic and this keeps DB load predictable.
  const heldPermissions: Permission[] = [];
  for (const permission of LANGY_CANDIDATE_PERMISSIONS) {
    if (await hasProjectPermission({ prisma, session }, projectId, permission)) {
      heldPermissions.push(permission);
    }
  }

  if (heldPermissions.length === 0) {
    throw new LangySessionKeyScopeError(
      "You do not hold any of the permissions Langy needs in this project, " +
        "so no Langy session key could be created for you.",
    );
  }

  const service = ApiKeyService.create(prisma);
  const { token } = await service.create({
    // Reserved name — hidden from the API-keys UI so per-session keys don't
    // clutter the list (see HIDDEN_SYSTEM_KEY_NAMES).
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
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
    expiresAt: new Date(Date.now() + LANGY_SESSION_KEY_TTL_MS),
  });

  return token;
}
