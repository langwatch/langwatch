import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { PromptApp } from "./app/prompt.app.ts";
import { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
import { promptRest, promptRestCredential, promptRestFacts } from "./transport/prompt.rest.ts";
import { promptTrpcTransport } from "./transport/prompt.trpc.ts";

/**
 * The prompt library's server: `prompts.*` and `promptTags.*` over one
 * application, plus the `/api/prompts` REST family the SDK and the CLI's
 * `sync` command both address.
 *
 * The playground's execution door (`transport/prompt-execute.api.ts`) is not
 * here: it streams server-sent events over a raw framework integration, which
 * `withTransports` does not carry, and it is mounted directly by the process
 * that composes a browser session for it.
 */
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
