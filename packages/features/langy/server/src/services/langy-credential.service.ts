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
import { z } from "zod/v4";

import { LangyCredentialRepository } from "../repositories/langy-credential.repository";

const virtualKeyConfigSchema = z
  .object({ modelsAllowed: z.array(z.string()).nullable().default(null) })
  .passthrough();

export interface LangySessionKeyService {
  mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }>;
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
  report(
    error: unknown,
    input: { projectId: string; userId: string; context: string },
  ): void;
}

export type LangyCredentialServiceOptions = {
  repository: LangyCredentialRepository;
  sessionKeys: LangySessionKeyService;
  virtualKeys: LangyVirtualKeyService;
  github: LangyGithubService;
  runtime: LangyCredentialRuntimeService;
  errors?: LangyCredentialErrorReporter;
};

/** Coordinates the worker credential envelope from injected feature ports. */
export class LangyCredentialService {
  constructor(private readonly deps: LangyCredentialServiceOptions) {}

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

    let langwatchApiKey: string | undefined;
    let langwatchApiKeyId: string | undefined;
    if (mintSessionKey) {
      try {
        const minted = await this.deps.sessionKeys.mint({
          session,
          projectId,
          organizationId: project.organizationId,
        });
        langwatchApiKey = minted.token;
        langwatchApiKeyId = minted.apiKeyId;
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "LangySessionKeyScopeError"
        ) {
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

    let githubToken: string | undefined;
    let githubLogin: string | undefined;
    let githubRepoScopeKey: string | undefined;
    if (this.deps.github.enabled) {
      try {
        const minted = await this.deps.github.mintTurnToken({
          organizationId: project.organizationId,
          ...(repositoryFullName ? { repositoryFullName } : {}),
        });
        if (minted) {
          githubToken = minted.token;
          githubRepoScopeKey = minted.repoScopeKey;
          githubLogin = resolveActingGithubLogin(session);
        }
      } catch (error) {
        this.deps.errors?.report(error, {
          projectId,
          userId: session.user.id,
          context: "mintTurnToken:LangyCredentialService.getOrProvision",
        });
      }
    }

    return {
      ...(langwatchApiKey ? { langwatchApiKey } : {}),
      ...(langwatchApiKeyId ? { langwatchApiKeyId } : {}),
      llmVirtualKey,
      langwatchEndpoint,
      gatewayBaseUrl: ensureGatewayV1BaseUrl(gatewayBaseUrl),
      organizationId: project.organizationId,
      ...(githubToken ? { githubToken } : {}),
      ...(githubLogin ? { githubLogin } : {}),
      ...(githubRepoScopeKey ? { githubRepoScopeKey } : {}),
    };
  }

  async tryGetModelsAllowedForProject(
    projectId: string,
  ): Promise<string[] | null> {
    const project = await this.deps.repository.tryFindProject(projectId);
    if (!project) return null;
    return this.tryGetModelsAllowed({
      projectId,
      organizationId: project.organizationId,
    });
  }

  async tryGetModelsAllowed(input: {
    projectId: string;
    organizationId: string;
  }): Promise<string[] | null> {
    const config = await this.deps.repository.tryFindVirtualKeyConfig(input);
    if (config == null) return null;
    const allowed = virtualKeyConfigSchema.parse(config ?? {}).modelsAllowed;
    return allowed && allowed.length > 0 ? allowed : null;
  }

  async resolveMirrorTier({
    projectId,
  }: {
    projectId: string;
  }): Promise<LangyMirrorTier> {
    return resolveLangyMirrorTier(
      { projectId },
      { LANGY_MIRROR_PROJECT_ID: this.deps.runtime.mirrorProjectId },
    );
  }

  async tryGetEgressAllowlist({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[] | null> {
    const value = await this.deps.repository.tryFindEgressAllowlist(projectId);
    if (value == null) return null;
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
    const normalized = parsed.map((host) =>
      host.trim().replace(/\.$/, "").toLowerCase(),
    );
    const value = normalized.length > 0 ? normalized : null;
    await this.deps.repository.saveEgressAllowlist(projectId, value);
    return value;
  }
}
