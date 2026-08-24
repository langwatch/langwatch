/**
 * Test-only compatibility constructor for the historical credential tests.
 * Production composition uses `@langwatch/langy-server` directly through the
 * adapters in `langy-credential-adapters.ts`.
 */
import {
  ensureGatewayV1BaseUrl,
  resolveActingGithubLogin,
  resolveLangyMirrorTier,
  resolveWorkerCallbackUrl as resolveCallbackUrl,
  resolveWorkerGatewayBaseUrl as resolveGatewayUrl,
  stripGithubCredentials,
} from "@langwatch/langy-contract";
import { LangyCredentialService as FeatureLangyCredentialService } from "@langwatch/langy-server/testing";
import type {
  LangyGithubService,
  LangySessionKeyService,
  LangyVirtualKeyService,
  LangyCredentialRuntimeService,
} from "@langwatch/langy-server/testing";
import { PrismaLangyCredentialRepository } from "@langwatch/langy-server/repositories/prisma/prisma.langy-credential.repository";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { mintLangySessionApiKey } from "./langyApiKey";
import { provisionLangyVirtualKey } from "./langyVirtualKey";

class TestSessionKeyService implements LangySessionKeyService {
  constructor(private readonly prisma: PrismaClient) {}

  mint(input: {
    session: Parameters<typeof mintLangySessionApiKey>[0]["session"];
    projectId: string;
    organizationId: string;
  }) {
    return mintLangySessionApiKey({
      prisma: this.prisma,
      session: input.session as Session,
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
  }
}

class TestVirtualKeyService implements LangyVirtualKeyService {
  constructor(private readonly prisma: PrismaClient) {}

  provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }) {
    return provisionLangyVirtualKey({ prisma: this.prisma, ...input });
  }
}

class TestGithubService implements LangyGithubService {
  readonly enabled = false;

  mintTurnToken(): Promise<null> {
    return Promise.resolve(null);
  }
}

class TestRuntimeService implements LangyCredentialRuntimeService {
  get workerCallbackUrl(): string | undefined {
    return resolveCallbackUrl(process.env);
  }
  get workerGatewayBaseUrl(): string | undefined {
    return resolveGatewayUrl(process.env);
  }

  get mirrorProjectId(): string | undefined {
    return process.env.LANGY_MIRROR_PROJECT_ID;
  }
}

export class LangyCredentialService extends FeatureLangyCredentialService {
  constructor(prisma: PrismaClient) {
    super({
      repository: PrismaLangyCredentialRepository.create(prisma),
      sessionKeys: new TestSessionKeyService(prisma),
      virtualKeys: new TestVirtualKeyService(prisma),
      github: new TestGithubService(),
      runtime: new TestRuntimeService(),
    });
  }
}

export function resolveWorkerCallbackUrl(
  values: Record<string, string | undefined> = process.env,
): string | undefined {
  return resolveCallbackUrl(values);
}

export function resolveWorkerGatewayBaseUrl(
  values: Record<string, string | undefined> = process.env,
): string | undefined {
  return resolveGatewayUrl(values);
}

export {
  ensureGatewayV1BaseUrl,
  resolveActingGithubLogin,
  resolveLangyMirrorTier,
  stripGithubCredentials,
};
export { LangyCredentialResolutionError } from "@langwatch/langy-contract";
