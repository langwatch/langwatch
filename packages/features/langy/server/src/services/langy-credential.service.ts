import {
  LangyCredentialResolutionError,
  langyEgressAllowlistSchema,
  type LangyCredentialSession,
  type LangyMirrorTier,
  type LangyWorkerCredentials,
  ensureGatewayV1BaseUrl,
  resolveActingGithubLogin,
  resolveLangyMirrorTier,
} from "@langwatch/langy-contract";
import { z } from "zod";

import { LangyCredentialRepository } from "../repositories/langy-credential.repository.ts";

const virtualKeyConfigSchema = z
  .object({ modelsAllowed: z.array(z.string()).nullable().default(null) })
  .passthrough();

export interface LangySessionKeyMintingService {
  mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }>;
  revokeManaged(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "refused">;
}

export interface LangyVirtualKeyService {
  provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string | null>;
}

export interface LangyGithubService {
  readonly enabled: boolean;
  mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<{ token: string; repoScopeKey: string } | null>;
}

export interface LangyCredentialRuntimeService {
  readonly workerCallbackUrl: string | undefined;
  readonly workerGatewayBaseUrl: string | undefined;
  readonly mirrorProjectId: string | undefined;
}

export interface LangyCredentialErrorReporter {
  report(error: unknown, input: { projectId: string; userId: string; context: string }): void;
}

export type LangyCredentialServiceOptions = {
  repository: LangyCredentialRepository;
  sessionKeys: LangySessionKeyMintingService;
  virtualKeys: LangyVirtualKeyService;
  github: LangyGithubService;
  runtime: LangyCredentialRuntimeService;
  errors?: LangyCredentialErrorReporter;
};

/** Coordinates the worker credential envelope from injected feature ports. */
export class LangyCredentialService {
  private constructor(private readonly deps: LangyCredentialServiceOptions) {}

  static create(options: LangyCredentialServiceOptions): LangyCredentialService {
    return new LangyCredentialService(options);
  }

  async getOrProvision({
    projectId,
    session,
    mintSessionKey = true,
    repositoryFullName,
  }: {
    projectId: string;
    session: LangyCredentialSession;
    mintSessionKey?: boolean;
    repositoryFullName?: string;
  }): Promise<LangyWorkerCredentials> {
    const project = await this.deps.repository.tryFindProject(projectId);
    if (!project) {
      throw new LangyCredentialResolutionError(`Project ${projectId} not found.`);
    }

    const langwatchEndpoint = this.deps.runtime.workerCallbackUrl;
    const gatewayBaseUrl = this.deps.runtime.workerGatewayBaseUrl;
    if (!langwatchEndpoint) {
      throw new Error("Langy worker callback origin is not configured");
    }

    if (!gatewayBaseUrl) {
      throw new Error("Langy gateway base URL is not configured");
    }

    const sessionKey = mintSessionKey
      ? await this.mintSessionKey({ projectId, organizationId: project.organizationId, session })
      : null;

    const llmVirtualKey = await this.deps.virtualKeys.provision({
      projectId,
      organizationId: project.organizationId,
      actorUserId: session.user.id,
    });
    if (!llmVirtualKey) {
      throw new LangyCredentialResolutionError(
        "Failed to provision Langy virtual key — no actor user could be resolved.",
      );
    }

    const github = await this.tryMintGithubToken({
      projectId,
      organizationId: project.organizationId,
      session,
      ...(repositoryFullName ? { repositoryFullName } : {}),
    });

    return {
      ...(sessionKey?.token ? { langwatchApiKey: sessionKey.token } : {}),
      ...(sessionKey?.apiKeyId ? { langwatchApiKeyId: sessionKey.apiKeyId } : {}),
      llmVirtualKey,
      langwatchEndpoint,
      gatewayBaseUrl: ensureGatewayV1BaseUrl(gatewayBaseUrl),
      organizationId: project.organizationId,
      ...github,
    };
  }

  /**
   * The session-scoped API key this turn runs under. A scope refusal is the caller's to act on, so
   * it keeps its own message; every other failure is reported and answered generically.
   */
  private async mintSessionKey({
    projectId,
    organizationId,
    session,
  }: {
    projectId: string;
    organizationId: string;
    session: LangyCredentialSession;
  }): Promise<{ token: string; apiKeyId: string }> {
    try {
      const minted = await this.deps.sessionKeys.mint({ session, projectId, organizationId });

      return { token: minted.token, apiKeyId: minted.apiKeyId };
    } catch (error) {
      if (error instanceof Error && error.name === "LangySessionKeyScopeError") {
        throw new LangyCredentialResolutionError(error.message);
      }

      this.deps.errors?.report(error, {
        projectId,
        userId: session.user.id,
        context: "mintLangySessionApiKey:LangyCredentialService.getOrProvision",
      });

      throw new LangyCredentialResolutionError(
        `Failed to mint a Langy session key for project ${projectId}.`,
      );
    }
  }

  /**
   * The GitHub half of a turn's credentials, best-effort: the integration may be off, may decline
   * to mint, or may fail, and none of those stops a turn that has everything else it needs.
   */
  private async tryMintGithubToken({
    projectId,
    organizationId,
    session,
    repositoryFullName,
  }: {
    projectId: string;
    organizationId: string;
    session: LangyCredentialSession;
    repositoryFullName?: string;
  }): Promise<{ githubToken?: string; githubLogin?: string; githubRepoScopeKey?: string }> {
    const github = this.deps.github;
    if (!github.enabled) {
      return {};
    }

    try {
      const minted = await this.deps.github.mintTurnToken({
        organizationId,
        ...(repositoryFullName ? { repositoryFullName } : {}),
      });
      if (!minted) {
        return {};
      }

      const githubLogin = resolveActingGithubLogin(session);

      return {
        githubToken: minted.token,
        githubRepoScopeKey: minted.repoScopeKey,
        ...(githubLogin ? { githubLogin } : {}),
      };
    } catch (error) {
      this.deps.errors?.report(error, {
        projectId,
        userId: session.user.id,
        context: "mintTurnToken:LangyCredentialService.getOrProvision",
      });

      return {};
    }
  }

  async tryGetModelsAllowedForProject(projectId: string): Promise<string[] | null> {
    const project = await this.deps.repository.tryFindProject(projectId);
    if (!project) {
      return null;
    }

    return this.tryGetModelsAllowed({
      projectId,
      organizationId: project.organizationId,
    });
  }

  revokeWorkerSessionKey(input: {
    apiKeyId: string;
    projectId: string;
  }): Promise<"revoked" | "already_revoked" | "not_found" | "refused"> {
    return this.deps.sessionKeys.revokeManaged(input);
  }

  async tryGetModelsAllowed(input: {
    projectId: string;
    organizationId: string;
  }): Promise<string[] | null> {
    const config = await this.deps.repository.tryFindVirtualKeyConfig(input);
    if (config == null) {
      return null;
    }

    const allowed = virtualKeyConfigSchema.parse(config ?? {}).modelsAllowed;

    return allowed && allowed.length > 0 ? allowed : null;
  }

  async resolveMirrorTier({ projectId }: { projectId: string }): Promise<LangyMirrorTier> {
    return resolveLangyMirrorTier(
      { projectId },
      { LANGY_MIRROR_PROJECT_ID: this.deps.runtime.mirrorProjectId },
    );
  }

  async tryGetEgressAllowlist({ projectId }: { projectId: string }): Promise<string[] | null> {
    const value = await this.deps.repository.tryFindEgressAllowlist(projectId);
    if (value == null) {
      return null;
    }

    const parsed = langyEgressAllowlistSchema.parse(value);

    return parsed.length > 0 ? parsed : null;
  }

  async trySetEgressAllowlist({
    projectId,
    allowlist,
  }: {
    projectId: string;
    allowlist: string[];
  }): Promise<string[] | null> {
    const parsed = langyEgressAllowlistSchema.parse(allowlist);
    const normalized = parsed.map((host) => host.trim().replace(/\.$/, "").toLowerCase());
    const value = normalized.length > 0 ? normalized : null;
    await this.deps.repository.saveEgressAllowlist(projectId, value);

    return value;
  }
}
