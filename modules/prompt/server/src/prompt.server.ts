import type { ProjectApi } from "@langwatch/project-contract";
import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { PromptApp } from "./app/prompt.app.ts";
import {
  PostgresPromptAdapter,
  type PostgresPromptAdapterOptions,
} from "./app/prompt-composition.build.ts";
import { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
import { promptRest, promptRestCredential, promptRestFacts } from "./transport/prompt.rest.ts";
import { promptTrpcTransport } from "./transport/prompt.trpc.ts";

/** Prompt library server — tRPC and REST transports; playground executor mounted separately. */
export const promptServer = defineServerModule("prompt")
  .withApp(PromptApp)
  .withTransports(promptRest, promptTrpcTransport, promptTagTrpcTransport)
  // Both facts come off the credential the request already carries: the
  // organization the project belongs to, and the deep link back into the
  // library, which the app builds from its own configured `publicBaseUrl`.
  .withTransportFacts(({ app }) => [
    bindRestMiddleware(promptRestFacts, (context) => {
      const { project } = projectCredentialOfRequest(context.req.raw);

      return {
        organizationId: project.organizationId,
        promptsUrl: app.promptsPlatformUrl({ projectSlug: project.slug }),
      };
    }),
    bindRestMiddleware(promptRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);

      return credential.type === "legacyProjectKey"
        ? { type: "legacyProjectKey" as const, projectId: credential.project.id }
        : {
            type: "apiKey" as const,
            apiKeyId: credential.apiKeyId,
            userId: credential.userId,
            organizationId: credential.organizationId,
          };
    }),
  ]);

/**
 * The prompt reader a worker composition mounts beside its own app: the
 * PostgreSQL-backed prompt service, wrapped in the same reader Prompt's own
 * process uses, over the process's own Prisma client.
 */
export function createPromptReader(
  options: PostgresPromptAdapterOptions & { projects: ProjectApi },
): PromptApp {
  const { projects, ...adapterOptions } = options;
  const prompts = PostgresPromptAdapter.create(adapterOptions).build();

  return PromptApp.createReader({ prompts, projects });
}
