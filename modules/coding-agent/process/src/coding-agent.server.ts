import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { CodingAgentApp } from "./app/coding-agent.app.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import {
  RedisCodingAgentProcessingRepository,
  type RedisCodingAgentProcessingRepositoryOptions,
} from "./repositories/redis/redis.coding-agent-processing.repository.ts";
import type { CodingAgentProcessingPipeline } from "./repositories/redis/redis.coding-agent-session-pipeline.repository.ts";
import { codingAgentV1Rest, codingAgentV1RestCaller } from "./transport/coding-agent-v1.rest.ts";
import {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
} from "./transport/coding-agent.rest.ts";
import { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";

export type { CodingAgentInfrastructure } from "./app/coding-agent.app.ts";

/**
 * The worker's one entry point into Coding Agent's durable session
 * processing (ADR-056) — everything it needs from this feature, without
 * naming the repository class that builds it.
 */
export interface CodingAgentProcessingCapability {
  buildProcessing(): CodingAgentProcessingPipeline;
}

/**
 * Composes Coding Agent's worker-facing processing capability from the
 * process's own substrates (its ClickHouse client, its Redis, its trace
 * canonicalisation).
 */
export function createCodingAgentProcessing(
  options: RedisCodingAgentProcessingRepositoryOptions,
): CodingAgentProcessingCapability {
  return RedisCodingAgentProcessingRepository.create(options);
}

export const codingAgentServer = defineServerModule("coding-agent")
  .withRepositories(codingAgentRepositories)
  .withApp(CodingAgentApp)
  .withTransports(
    codingAgentRest,
    codingAgentRollupRest,
    codingAgentV1Rest,
    codingAgentTrpcTransport,
  )
  .withTransportFacts(() => [
    bindRestMiddleware(codingAgentRestCaller, (context) => {
      const resolved = projectCredentialOfRequest(context.req.raw);

      return {
        project: {
          isPersonal: resolved.project.isPersonal,
          ownerUserId: resolved.project.ownerUserId,
        },
        credential: credentialPrincipalOfToken(resolved),
      };
    }),
    bindRestMiddleware(codingAgentV1RestCaller, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        // The member the credential acts as, or the credential itself where it
        // acts as nobody - one stable string per credential either way.
        actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
      };
    }),
  ]);
