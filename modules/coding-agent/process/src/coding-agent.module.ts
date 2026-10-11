import {
  credentialPrincipalOfToken,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { CodingAgentApi, CodingAgentServerConfig } from "@langwatch/coding-agent-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { CodingAgentModule } from "./app/coding-agent.app.ts";
import { codingAgentEventing } from "./eventing/coding-agent-processing.pipeline.ts";
import { codingAgentRepositories } from "./repositories/coding-agent-repositories.registry.ts";
import { codingAgentV1Rest } from "./transport/coding-agent-v1.rest.ts";
import { codingAgentRest, codingAgentRollupRest } from "./transport/coding-agent.rest.ts";
import { codingAgentTrpcTransport } from "./transport/coding-agent.trpc.ts";

export const codingAgentProcessModule: PublishedProcessModule<
  "coding-agent",
  CodingAgentApi,
  CodingAgentServerConfig
> = defineProcessModule("coding-agent")
  .withRepositories(codingAgentRepositories)
  .withApi(CodingAgentModule)
  .withTransports(
    codingAgentRest,
    codingAgentRollupRest,
    codingAgentV1Rest,
    codingAgentTrpcTransport,
  )
  .withEventing(codingAgentEventing)
  .provideMiddlewareContext({
    codingAgentRestCaller: (request) => {
      const resolved = projectCredentialOfRequest(request);

      return {
        project: {
          isPersonal: resolved.project.isPersonal,
          ownerUserId: resolved.project.ownerUserId,
        },
        credential: credentialPrincipalOfToken(resolved),
      };
    },
    codingAgentV1RestCaller: (request) => {
      const credential = organizationCredentialOfRequest(request);

      return {
        apiKeyId: credential.apiKeyId,
        userId: credential.userId,
        // The member the credential acts as, or the credential itself where it
        // acts as nobody - one stable string per credential either way.
        actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
      };
    },
  })
  .withMigrations(({ app }) => [
    defineMigrationStep({
      id: "coding-agent:fill-id-indexes",
      after: ["suite:fill-id-indexes"],
      kind: "data",
      mode: "background",
      description:
        "Fills the id indexes of coding-agent sessions, events and trace mappings from older rows, then marks them ready on each ClickHouse target.",
      needsOldWritersGone: false,
      // Level-triggered: a rerun merges the same ranges and resumes at the saved cursor.
      run: ({ checkpoint, dryRun, signal }) => app.fillIdIndexes({ checkpoint, dryRun, signal }),
    }),
  ]);
