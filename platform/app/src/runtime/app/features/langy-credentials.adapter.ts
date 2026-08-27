import type { GithubService } from "@langwatch/github-contract";
import type { LangySessionKeyService } from "@langwatch/langy-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { provisionLangyVirtualKey } from "./langy-virtual-key.adapter";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:langy:credentials");

class AppLangyVirtualKeyAdapter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly virtualKeys: VirtualKeyService,
  ) {}

  provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string | null> {
    return provisionLangyVirtualKey({
      prisma: this.prisma,
      virtualKeys: this.virtualKeys,
      ...input,
    });
  }
}

class AppLangyGithubAdapter {
  constructor(private readonly github: GithubService) {}

  get enabled(): boolean {
    return true;
  }

  async mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<{ token: string; repoScopeKey: string } | null> {
    const result = await this.github.tryMintTurnToken(input);
    return result ? { token: result.token, repoScopeKey: result.repoScopeKey } : null;
  }
}

class ConfiguredLangyCredentialRuntimeAdapter {
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

class AppLangyCredentialErrorReporter {
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

export function createAppLangyCredentialComposition(input: {
  sessionKeys: LangySessionKeyService;
  prisma: PrismaClient;
  virtualKeys: VirtualKeyService;
  github: GithubService;
  workerCallbackUrl?: string;
  workerGatewayBaseUrl?: string;
  mirrorProjectId?: string;
}) {
  return {
    sessionKeys: input.sessionKeys,
    virtualKeys: new AppLangyVirtualKeyAdapter(input.prisma, input.virtualKeys),
    github: new AppLangyGithubAdapter(input.github),
    runtime: new ConfiguredLangyCredentialRuntimeAdapter({
      workerCallbackUrl: input.workerCallbackUrl,
      workerGatewayBaseUrl: input.workerGatewayBaseUrl,
      mirrorProjectId: input.mirrorProjectId,
    }),
    errors: new AppLangyCredentialErrorReporter(),
  };
}
