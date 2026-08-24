import type { LangyCredentialSession } from "@langwatch/langy-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { mintLangySessionApiKey } from "./langyApiKey";
import { provisionLangyVirtualKey } from "./langyVirtualKey";
import type { GithubInstallationsService } from "../github/github-installations.service";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy:credentials");

export class AppLangySessionKeyService {
  constructor(private readonly prisma: PrismaClient) {}

  mint(input: {
    session: LangyCredentialSession;
    projectId: string;
    organizationId: string;
  }): Promise<{ token: string; apiKeyId: string }> {
    return mintLangySessionApiKey({
      prisma: this.prisma,
      session: input.session as Session,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
  }
}

export class AppLangyVirtualKeyService {
  constructor(private readonly prisma: PrismaClient) {}

  provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string | null> {
    return provisionLangyVirtualKey({ prisma: this.prisma, ...input });
  }
}

export class AppLangyGithubService {
  constructor(private readonly installations: GithubInstallationsService) {}

  get enabled(): boolean {
    return true;
  }

  async mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<{ token: string; repoScopeKey: string } | null> {
    const result = await this.installations.mintTurnToken(input);
    return result
      ? { token: result.token, repoScopeKey: result.repoScopeKey }
      : null;
  }
}

export class ConfiguredLangyCredentialRuntimeService {
  constructor(
    private readonly config: {
      workerCallbackUrl?: string;
      workerGatewayBaseUrl?: string;
      mirrorProjectId?: string;
    },
  ) {}

  get workerCallbackUrl(): string | undefined {
    return this.config.workerCallbackUrl;
  }

  get workerGatewayBaseUrl(): string | undefined {
    return this.config.workerGatewayBaseUrl;
  }

  get mirrorProjectId(): string | undefined {
    return this.config.mirrorProjectId;
  }
}

export class AppLangyCredentialErrorReporter {
  report(
    error: unknown,
    input: { projectId: string; userId: string; context: string },
  ): void {
    logger.warn(
      { error, projectId: input.projectId, userId: input.userId },
      "Langy credential capability failed; continuing without optional capability",
    );
    captureException(toError(error), { extra: { ...input } });
  }
}

export function createAppLangyCredentialComposition({
  prisma,
  github,
  workerCallbackUrl,
  workerGatewayBaseUrl,
  mirrorProjectId,
}: {
  prisma: PrismaClient;
  github: GithubInstallationsService;
  workerCallbackUrl?: string;
  workerGatewayBaseUrl?: string;
  mirrorProjectId?: string;
}) {
  return () => ({
    sessionKeys: new AppLangySessionKeyService(prisma),
    virtualKeys: new AppLangyVirtualKeyService(prisma),
    github: new AppLangyGithubService(github),
    runtime: new ConfiguredLangyCredentialRuntimeService({
      workerCallbackUrl,
      workerGatewayBaseUrl,
      mirrorProjectId,
    }),
    errors: new AppLangyCredentialErrorReporter(),
  });
}
