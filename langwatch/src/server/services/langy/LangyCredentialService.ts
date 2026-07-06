import type { PrismaClient } from "@prisma/client";

import { parseVirtualKeyConfig } from "~/server/gateway/virtualKey.config";
import { ProjectRepository } from "~/server/projects/project.repository";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { getLangyApiKeyToken, provisionLangyApiKey } from "./langyApiKey";
import { getGithubTokenForUser } from "./langyGithubToken";
import { provisionLangyVirtualKey } from "./langyVirtualKey";

const githubLogger = createLogger("langwatch:langy:credentials:github");

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
 * missing provider credential, missing env config. The /chat route turns
 * these into 409s so the user gets a clear actionable error rather than
 * a generic 500.
 */
export class LangyCredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangyCredentialResolutionError";
  }
}

export type LangyCredentials = {
  /** Project's sk-lw-* key. Used by the MCP server in the worker to call the LW API. */
  langwatchApiKey: string;
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
};

/**
 * Resolves the credentials a Langy worker subprocess needs in its env.
 *
 * Per-project model: one Langy VK is auto-provisioned on first use and
 * stored encrypted in ProjectSecret. All Langy chats in that project
 * share that VK. Cost attribution is per-project, not per-user — when
 * we want per-user attribution we'll add a per-user secret store.
 */
export class LangyCredentialService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): LangyCredentialService {
    return new LangyCredentialService(prisma);
  }

  async getOrProvision({
    projectId,
    actorUserId,
  }: {
    projectId: string;
    actorUserId: string;
  }): Promise<LangyCredentials> {
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

    // Use the dedicated, least-privilege "Langy" key (LANGY_REQUIRED_PERMISSIONS
    // only). Provision-on-first-use makes it self-healing if project creation
    // missed it. Fail-closed if it can't be created — falling back to
    // project.apiKey (full ingestion power) would silently bypass the RBAC
    // gate the chat route enforces on every request.
    await provisionLangyApiKey({
      prisma: this.prisma,
      projectId,
      organizationId: project.organizationId,
      createdByUserId: actorUserId,
    });
    const langyApiKeyToken = await getLangyApiKeyToken({
      prisma: this.prisma,
      projectId,
    });
    if (!langyApiKeyToken) {
      throw new LangyCredentialResolutionError(
        `Failed to provision Langy API key for project ${projectId} — ` +
          "no user could be attributed (the project's organization has no " +
          "resolvable members). Ensure the org has at least one active member.",
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
      const gh = await getGithubTokenForUser({
        prisma: this.prisma,
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
      langwatchApiKey: langyApiKeyToken,
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
}
