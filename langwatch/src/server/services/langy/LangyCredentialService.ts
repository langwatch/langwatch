import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { Session } from "~/server/auth";
import { getApp } from "~/server/app-layer";
import { DomainError } from "~/server/app-layer/domain-error";
import { parseVirtualKeyConfig } from "~/server/gateway/virtualKey.config";
import { ProjectRepository } from "~/server/projects/project.repository";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  LangySessionKeyScopeError,
  mintLangySessionApiKey,
} from "./langyApiKey";
import { provisionLangyVirtualKey } from "./langyVirtualKey";

const logger = createLogger("langwatch:langy:credentials");
const githubLogger = createLogger("langwatch:langy:credentials:github");

/**
 * The per-project Langy egress allow-list (ADR-043). Each entry is either an
 * exact host (`registry.npmjs.org`) or a single-leading-label wildcard
 * (`*.internal.acme.com`). Validated at read time so a drifted column value
 * fails closed (throws) rather than silently disabling enforcement — the same
 * posture `getModelsAllowed` takes on a malformed VK config. Kept in sync with
 * the Go matcher (`hostMatchesAny` in
 * services/langyagent/adapters/egress/policy.go).
 */
const egressHostPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(\*\.)?([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.?$/,
    "egress allow-list entries must be a host or a *.suffix wildcard",
  );

export const langyEgressAllowlistSchema = z.array(egressHostPatternSchema);

/**
 * The Langy worker hands `gatewayBaseUrl` straight to OpenCode as
 * `OPENAI_BASE_URL`, so it must point at the gateway's OpenAI-compatible
 * surface — the `/v1` prefix under which `/responses` and `/chat/completions`
 * live. `LW_GATEWAY_BASE_URL` is shared with the Go gateway's control-plane
 * discovery and is set without `/v1` in some deployments (the SaaS dev
 * cluster shipped `http://langwatch-gateway:80`), which made the worker POST
 * to `/responses` → 404. Normalise here so Langy is correct regardless of how
 * the deployment spells the env. Idempotent: a value already ending in `/v1`
 * is returned unchanged.
 */
export function ensureGatewayV1BaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * Thrown when credential resolution can't complete — missing project,
 * missing provider credential, missing env config. A `DomainError` (kind
 * `langy_credential_resolution`, httpStatus 409) so it serialises uniformly
 * through the shared `onError → handleError` path with a proper status/kind,
 * and `classifyLangyTurnError` renders it on the chat stream — instead of the
 * /chat route hand-mapping it to a 409. The message is user-safe by
 * construction (it is the copy shown to the user); nothing internal is carried.
 */
export class LangyCredentialResolutionError extends DomainError {
  constructor(message: string) {
    super("langy_credential_resolution", message, { httpStatus: 409 });
    this.name = "LangyCredentialResolutionError";
  }
}

export type LangyCredentials = {
  /**
   * Ephemeral per-WORKER sk-lw-* key scoped to the requesting user's own
   * permissions (ADR-047). Used by the MCP server in the worker to call the LW
   * API, so a Langy tool call can never exceed what the caller could do by hand.
   *
   * OPTIONAL, and its absence is meaningful: when the manager already has a live
   * worker for this conversation, that worker holds its key in its process
   * environment, and a new one would be minted only to be discarded unread. So we
   * send none. The manager accepts a keyless bundle for a REUSE and refuses it
   * for a spawn — see `Credentials.Spawnable` / ErrCredentialsRequired on the Go
   * side, which is how the die-between-probe-and-turn race is resolved.
   */
  langwatchApiKey?: string;
  /**
   * The id of the key above. Handed to the manager purely so it can ask us to
   * REVOKE that key when the worker dies. It names a credential without
   * conferring any power over it, which keeps the manager's authority at "destroy
   * what I was given" rather than "mint whatever I name".
   */
  langwatchApiKeyId?: string;
  /** Project's Langy VK secret. Used by opencode as OPENAI_API_KEY against the AI gateway. */
  llmVirtualKey: string;
  /** Control plane base URL — set as LANGWATCH_ENDPOINT for the MCP server. */
  langwatchEndpoint: string;
  /** AI gateway base URL — set as OPENAI_BASE_URL for opencode. */
  gatewayBaseUrl: string;
  /**
   * The organization the project belongs to. Returned here so callers that
   * already resolved credentials don't re-fetch the project to discover its
   * org (the route's allowlist-check path used to do this and risked a
   * race where the project disappeared between calls).
   */
  organizationId: string;
  /**
   * Short-lived GitHub user-to-server access token (~8h) for the requesting
   * user. Absent when GitHub is not configured on the instance, the user has
   * not connected, or the refresh failed. The worker injects this as
   * `GH_TOKEN` so `gh` and the credential helper read it from env only —
   * never written to disk.
   */
  githubToken?: string;
  /**
   * The user's GitHub login (e.g. "aryansharma28"). Used by the worker for
   * commit attribution (`git config user.name`) and surfaced in the
   * "Acting as @login" sidebar chip.
   */
  githubLogin?: string;
  /**
   * The project's Langy egress allow-list (ADR-043). Threaded into the agent's
   * per-request credentials envelope; the worker's egress adapter is
   * constructed with it at spawn. Absent/empty ⇒ monitor-only (the adapter
   * watches but blocks nothing); non-empty ⇒ the adapter restricts outbound to
   * floor ∪ this list. The *presence* of the list is the enforcement mode.
   */
  egressAllowlist?: string[];
};

/**
 * Resolves the credentials a Langy worker subprocess needs in its env.
 *
 * The LangWatch API key is minted PER CHAT SESSION and scoped to the requesting
 * user's own permissions (ADR-047) — so a Langy tool call can never exceed what
 * the caller could do by hand. The LLM virtual key, by contrast, is per-project:
 * one Langy VK is auto-provisioned on first use and stored encrypted in
 * ProjectSecret, and all Langy chats in that project share it. Cost attribution
 * is per-project, not per-user — when we want per-user attribution we'll add a
 * per-user secret store.
 */
export class LangyCredentialService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): LangyCredentialService {
    return new LangyCredentialService(prisma);
  }

  /**
   * Resolves the credential bundle for a turn.
   *
   * `mintSessionKey` is the seam that makes "probe before minting" possible.
   *
   * The session key lives in the WORKER's environment, injected at spawn, and a
   * reused worker keeps the one it booted with. So on the common path — a
   * follow-up message on a live worker — a freshly minted key is written to the
   * database, pushed to the manager, discarded unread, and left valid for hours.
   * Measured on a dev box: 41 keys minted, 14 ever used. That is credential
   * sprawl, and the write was on the critical path of every message.
   *
   * The caller therefore resolves everything EXCEPT the key first (which is also
   * everything the worker signature is made of — model, GitHub-token presence,
   * egress allow-list), asks the manager whether a matching worker is already
   * running, and only mints when the answer is no.
   */
  async getOrProvision({
    projectId,
    session,
    mintSessionKey = true,
  }: {
    projectId: string;
    session: Session;
    mintSessionKey?: boolean;
  }): Promise<LangyCredentials> {
    const actorUserId = session.user.id;
    const projectRepo = new ProjectRepository(this.prisma);
    const project = await projectRepo.findForLangyCredentials(projectId);
    if (!project) {
      throw new LangyCredentialResolutionError(
        `Project ${projectId} not found.`,
      );
    }

    const langwatchEndpoint = process.env.LANGWATCH_API_URL;
    const gatewayBaseUrl =
      process.env.LW_GATEWAY_PUBLIC_URL ?? process.env.LW_GATEWAY_BASE_URL;
    if (!langwatchEndpoint) {
      throw new LangyCredentialResolutionError(
        "LANGWATCH_API_URL is not configured on the control plane.",
      );
    }
    if (!gatewayBaseUrl) {
      throw new LangyCredentialResolutionError(
        "LW_GATEWAY_BASE_URL is not configured on the control plane.",
      );
    }

    // Mint a per-session key scoped to THIS user's own permissions (ADR-047).
    // The key is owned by the user, so ApiKeyService clamps it to what they
    // actually hold — a Langy tool call can never exceed the human. Fail-closed:
    // wrap mint failures as LangyCredentialResolutionError so the route returns a
    // 409 rather than falling back to a broader key. A user who holds none of
    // Langy's permissions here gets a clean, actionable refusal.
    let langwatchApiKey: string | undefined;
    let langwatchApiKeyId: string | undefined;
    try {
      if (mintSessionKey) {
        const minted = await mintLangySessionApiKey({
          prisma: this.prisma,
          session,
          projectId,
          organizationId: project.organizationId,
        });
        langwatchApiKey = minted.token;
        langwatchApiKeyId = minted.apiKeyId;
      }
    } catch (error) {
      if (error instanceof LangySessionKeyScopeError) {
        // Carries a user-safe message (the caller holds no Langy permissions
        // in this project) — surface it verbatim as the 409 body.
        throw new LangyCredentialResolutionError(error.message);
      }
      logger.error(
        { error, projectId, userId: actorUserId },
        "failed to mint Langy session key",
      );
      captureException(toError(error), {
        extra: {
          projectId,
          context:
            "mintLangySessionApiKey:LangyCredentialService.getOrProvision",
        },
      });
      throw new LangyCredentialResolutionError(
        `Failed to mint a Langy session key for project ${projectId}.`,
      );
    }

    const llmVirtualKey = await this.getOrProvisionVirtualKey({
      projectId,
      organizationId: project.organizationId,
      actorUserId,
    });

    // Best-effort GitHub token mint. Never blocks chat — when absent the
    // worker's github.md skill tells the user to connect, instead of erroring.
    let githubToken: string | undefined;
    let githubLogin: string | undefined;
    try {
      const gh = await getApp().langy.githubCredentials.getAccessToken({
        userId: actorUserId,
        organizationId: project.organizationId,
      });
      if (gh) {
        githubToken = gh.token;
        githubLogin = gh.githubLogin;
      }
    } catch (error) {
      githubLogger.warn(
        { error, projectId, userId: actorUserId },
        "github token mint failed; chat continues without it",
      );
      captureException(toError(error), {
        extra: {
          projectId,
          context:
            "getGithubTokenForUser:LangyCredentialService.getOrProvision",
        },
      });
    }

    return {
      // Absent when the caller asked us not to mint because a live worker already
      // holds a key. The manager accepts a keyless bundle for a REUSE and refuses
      // it for a spawn (ErrCredentialsRequired), which is how the die-between-
      // probe-and-turn race is resolved rather than guessed at.
      ...(langwatchApiKey ? { langwatchApiKey } : {}),
      ...(langwatchApiKeyId ? { langwatchApiKeyId } : {}),
      llmVirtualKey,
      langwatchEndpoint,
      gatewayBaseUrl: ensureGatewayV1BaseUrl(gatewayBaseUrl),
      organizationId: project.organizationId,
      ...(githubToken ? { githubToken } : {}),
      ...(githubLogin ? { githubLogin } : {}),
    };
  }

  private async getOrProvisionVirtualKey(args: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string> {
    // Delegates to the standalone helper so /chat-time self-healing and the
    // eager project.create path share one implementation. At chat time we
    // always have an authenticated user, so the helper's null fallback path
    // is unreachable here — assert non-null to satisfy the caller's type.
    const secret = await provisionLangyVirtualKey({
      prisma: this.prisma,
      ...args,
    });
    if (!secret) {
      throw new LangyCredentialResolutionError(
        "Failed to provision Langy virtual key — no actor user could be resolved.",
      );
    }
    return secret;
  }

  /**
   * Returns the `modelsAllowed` array on the project's Langy VK. Null means
   * "no allowlist set" — every eligible model is allowed (the gateway is the
   * final allowlist in that case). Used by /langy/chat to validate the
   * picker's per-send `modelOverride` server-side so the gateway isn't the
   * only line of defense.
   *
   * Tenancy is enforced at the DB layer (organizationId in the WHERE) rather
   * than via a post-fetch in-memory filter, so a stray scope row pointing to
   * the right projectId but a wrong-org VK can't reach this code path. The
   * config blob is parsed through Zod so a corrupted/drifted VK config
   * surfaces as a parse error instead of silently disabling enforcement.
   */
  async getModelsAllowed({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<string[] | null> {
    // status=ACTIVE + orderBy:updatedAt-desc protect against the duplicate-VK
    // race documented at `langyVirtualKey.ts:82-95`: a lost first-chat race
    // leaves a second `purpose=LANGY` row alive. Without `status=ACTIVE` an
    // archived twin's `modelsAllowed` could be returned; without `orderBy`,
    // a `findFirst` could pick the OTHER row from the one the gateway
    // authenticates against. Take the most recently updated active row as a
    // stable tiebreaker — that's also the one the gateway picks via its own
    // unique-by-hashedSecret lookup since the live row's `updatedAt` is
    // touched on every rotation.
    const langyVk = await this.prisma.virtualKey.findFirst({
      where: {
        organizationId,
        purpose: "LANGY",
        status: "ACTIVE",
        scopes: {
          some: { scopeType: "PROJECT", scopeId: projectId },
        },
      },
      orderBy: { updatedAt: "desc" },
      select: { config: true },
    });
    if (!langyVk) return null;
    const parsed = parseVirtualKeyConfig(langyVk.config);
    const allowed = parsed.modelsAllowed;
    return allowed && allowed.length > 0 ? allowed : null;
  }

  /**
   * Returns the project's Langy egress allow-list (ADR-043 rung 2), or `null`
   * when unset/empty. `null` ⇒ monitor-only (the agent's egress adapter
   * watches but blocks nothing); a non-empty array ⇒ the enforced set (the
   * adapter restricts outbound to floor ∪ this list). Same `null-means-watch`
   * convention as `getModelsAllowed`.
   *
   * Unlike the model allow-list — which lives on the VirtualKey because the
   * *gateway* enforces it — the egress list is a project network policy
   * enforced by the *agent pod's egress adapter*, so it lives on the Project
   * (ADR-043 §"Where the allow-list config lives"). The value is parsed through
   * Zod so a drifted/corrupt column fails closed (throws) rather than silently
   * disabling enforcement — a stray non-array or a bad host pattern must not
   * quietly open egress.
   */
  async getEgressAllowlist({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[] | null> {
    // The Project row IS the tenant root here; its id is the projectId filter
    // (multitenancy). No cross-project value can be returned.
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { langyEgressAllowlist: true },
    });
    if (!project || project.langyEgressAllowlist == null) return null;
    const parsed = langyEgressAllowlistSchema.parse(
      project.langyEgressAllowlist,
    );
    return parsed.length > 0 ? parsed : null;
  }

  /**
   * Writes the project's Langy egress allow-list (ADR-043). Validates + trims
   * every entry through the same Zod schema the resolver reads by, so a client
   * cannot persist a malformed host pattern. An empty array clears the column
   * to `null` (monitor-only) — the canonical "unset" state — rather than
   * storing `[]`, keeping the resolver's null/empty branches equivalent.
   * Setting or clearing the list takes effect on the conversation's next turn
   * (the worker recycles when its egress signature changes).
   */
  async setEgressAllowlist({
    projectId,
    allowlist,
  }: {
    projectId: string;
    allowlist: string[];
  }): Promise<string[] | null> {
    const parsed = langyEgressAllowlistSchema.parse(allowlist);
    const normalized = parsed.map((h) =>
      h.trim().replace(/\.$/, "").toLowerCase(),
    );
    const value = normalized.length > 0 ? normalized : null;
    await this.prisma.project.update({
      where: { id: projectId },
      data: { langyEgressAllowlist: value ?? Prisma.DbNull },
    });
    return value;
  }
}
