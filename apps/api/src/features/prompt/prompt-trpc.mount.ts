/**
 * Binds the prompt module's two declared namespaces - `prompts.*` and
 * `promptTags.*` - to this process's tRPC root. Both read off the same
 * installed application; the behaviour lives in `@langwatch/prompt-server`.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { PromptApi } from "@langwatch/prompt-contract";
import { promptTagTrpcTransport, promptTrpcTransport } from "@langwatch/prompt-server";

/** The one slice of the process context these two namespaces read. */
export interface PromptHostContext {
  app: Readonly<{ prompts: PromptApi }>;
}

/** Mounts both namespaces on the app process's declared tRPC runtime. */
export function createPromptTrpcRouters<TContext extends PromptHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  const prompts = (ctx: TContext) => ctx.app.prompts;

  return {
    prompts: runtime.mount(promptTrpcTransport, prompts),
    promptTags: runtime.mount(promptTagTrpcTransport, prompts),
  };
}
