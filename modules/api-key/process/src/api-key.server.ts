import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";
import type { Instant } from "@langwatch/time";

import { ApiKeyApp } from "./app/api-key.app.ts";
import { apiKeyEventing } from "./eventing/api-key.pipeline.ts";
import { apiKeyRepositories } from "./repositories/api-key-repositories.registry.ts";
import { ApiKeyTokenAdapter } from "./repositories/memory/memory.api-key-token.repository.ts";
import {
  PrismaApiKeyRepository,
  type PrismaApiKeyDatabase,
} from "./repositories/prisma/prisma.api-key.repository.ts";
import { AgentSandboxKeyReapService } from "./services/agent-sandbox-key-reap.service.ts";
import { CliLoginKeyReapService } from "./services/cli-login-key-reap.service.ts";
import { apiKeyRest, apiKeyRestCredential } from "./transport/api-key.rest.ts";
import { apiKeyTrpcTransport } from "./transport/api-key.trpc.ts";

/**
 * Runtime seams: thin factories over this feature's private classes, so a
 * composition root never names one directly (private-runtime-export drive,
 * dev/docs/plans/private-runtime-export-drive.md §3d).
 */

/** Wraps the static secret hasher so a caller never names the token adapter class. */
export function hashApiKeySecret(secret: string, pepper: string): string {
  return ApiKeyTokenAdapter.hashApiKeySecret(secret, pepper);
}

/** The sandbox-key sweep over the process's own Prisma-backed repository. */
export function createAgentSandboxKeyReapService(options: {
  database: PrismaApiKeyDatabase;
  now?: () => Instant;
}): AgentSandboxKeyReapService {
  return AgentSandboxKeyReapService.create({
    repository: PrismaApiKeyRepository.create({ prisma: options.database }),
    now: options.now,
  });
}

/** The expired CLI-login-key sweep over the installed app and its own repository. */
export function createCliLoginKeyReapService(options: {
  database: PrismaApiKeyDatabase;
  apiKeys: ApiKeyApi;
  now?: () => Instant;
}): CliLoginKeyReapService {
  return CliLoginKeyReapService.create({
    repository: PrismaApiKeyRepository.create({ prisma: options.database }),
    revoke: ({ id, organizationId, userId }) =>
      options.apiKeys.revoke({
        id,
        organizationId,
        callerUserId: userId,
        callerIsAdmin: true,
        cause: "expired",
      }),
    now: options.now,
  });
}

/**
 * The whole module, declared. Every call answers something already
 * installable, so there is no build step to forget. What the process must
 * hand it is read off `ApiKeyApp.create` and the repository registry.
 */
export const apiKeyServer = defineServerModule("api-key")
  .withRepositories(apiKeyRepositories)
  .withApp(ApiKeyApp)
  .withTransports(apiKeyRest, apiKeyTrpcTransport)
  // The credential itself, not just its holder: two of these routes ask whether
  // the KEY may act organization-wide as well as whether the member may, so a
  // narrowed key cannot borrow the reach of whoever created it.
  .withTransportFacts(() => [
    bindRestMiddleware(apiKeyRestCredential, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { apiKeyId: credential.apiKeyId, userId: credential.userId };
    }),
  ])
  .withEventing(apiKeyEventing);
