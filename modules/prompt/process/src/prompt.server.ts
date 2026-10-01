import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { PromptApp } from "./app/prompt.app.ts";
import { promptLifecycleEventing } from "./eventing/prompt-lifecycle.pipeline.ts";
import { promptRepositories } from "./repositories/prompt-repositories.registry.ts";
import { promptExecuteRest } from "./transport/prompt-execute.rest.ts";
import { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
import { promptRest, promptRestFacts } from "./transport/prompt.rest.ts";
import { promptTrpcTransport } from "./transport/prompt.trpc.ts";

/** Prompt library server — tRPC, REST, and the browser-only playground stream. */
export const promptServer = defineServerModule("prompt")
  .withRepositories(promptRepositories)
  .withApp(PromptApp)
  .withTransports(promptRest, promptExecuteRest, promptTrpcTransport, promptTagTrpcTransport)
  .withEventing(promptLifecycleEventing)
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
  ]);
