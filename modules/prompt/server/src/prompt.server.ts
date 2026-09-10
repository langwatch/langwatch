import { defineServerModule } from "@langwatch/runtime-composition";
import { PromptApp } from "./app/prompt.app.ts";
import { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
import { promptRest } from "./transport/prompt.rest.ts";
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
  .build();
