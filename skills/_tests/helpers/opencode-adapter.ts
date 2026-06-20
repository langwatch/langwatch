import {
  AgentRole,
  type AgentAdapter,
  type AgentInput,
} from "@langwatch/scenario";
import {
  createOpencode,
  createOpencodeClient,
} from "@opencode-ai/sdk";
import { renderContent } from "./render-content";

/**
 * A `{ providerID, modelID }` pair identifying the model opencode should drive,
 * e.g. `{ providerID: "anthropic", modelID: "claude-haiku-4-5" }`. opencode
 * resolves the provider's credentials from its own auth config (see
 * {@link createOpenCodeAgent}); the adapter never injects keys.
 */
export interface OpenCodeModel {
  providerID: string;
  modelID: string;
}

/**
 * Minimal structural slice of the `@opencode-ai/sdk` client that the adapter
 * actually uses. Declaring the narrow shape (instead of the full
 * `OpencodeClient`) lets unit tests inject a fake client with no real server,
 * and keeps the SDK coupling to exactly the two calls this adapter makes.
 *
 * Both methods mirror the SDK's "fields" response envelope, where the payload
 * lives under `data` and may be `undefined` on error.
 */
export interface OpenCodeClientLike {
  session: {
    create: (options?: {
      body?: { title?: string };
    }) => Promise<{ data?: { id: string } }>;
    prompt: (options: {
      path: { id: string };
      body: { model: OpenCodeModel; parts: { type: "text"; text: string }[] };
    }) => Promise<{ data?: { parts?: unknown[] } }>;
  };
}

/**
 * A started opencode server bundled with the client bound to it and a `close`
 * handle the adapter is responsible for calling when the run is torn down.
 */
export interface OpenCodeServerHandle {
  client: OpenCodeClientLike;
  close: () => void;
}

/**
 * Collapse opencode's response `parts` array into a single text string.
 *
 * opencode returns a heterogeneous `Part[]` (text, file, tool, …). We keep only
 * the text parts and join them. Defensive by construction: a non-array input
 * (e.g. `undefined` on an errored response) yields `""`, and any non-object or
 * unknown part type is skipped rather than throwing.
 */
export const partsToText = (parts: unknown): string => {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (part != null && typeof part === "object" && (part as any).type === "text") {
        return (part as any).text ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

/**
 * Derive the prompt text to send to opencode from the scenario turn.
 *
 * opencode holds the conversation server-side per session, so we only send the
 * latest user turn rather than replaying the whole history. Prefer the newest
 * user message in `newMessages`; fall back to the newest user message in the
 * full `messages` history; only if no user message exists anywhere do we render
 * the entire history as a last resort.
 */
const latestUserText = (input: AgentInput): string => {
  const lastUserMessage = (
    messages: AgentInput["messages"]
  ): AgentInput["messages"][number] | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i];
    }
    return undefined;
  };

  const userMessage =
    lastUserMessage(input.newMessages) ?? lastUserMessage(input.messages);
  if (userMessage) return renderContent(userMessage.content);

  return input.messages
    .map((message) => `${message.role}: ${renderContent(message.content)}`)
    .join("\n\n");
};

/**
 * Start an opencode server via the SDK and return a client bound to it.
 *
 * `createOpencode` auto-spawns `opencode serve` and hands back a client plus a
 * `close` handle. Neither `createOpencode` nor its `ServerOptions` exposes a
 * working-directory knob, so when `workingDirectory` is requested we re-bind a
 * directory-scoped client to the same auto-spawned server's URL.
 */
const defaultStartServer = async ({
  workingDirectory,
}: {
  workingDirectory?: string;
}): Promise<OpenCodeServerHandle> => {
  const { client, server } = await createOpencode({});
  const scopedClient = workingDirectory
    ? createOpencodeClient({ baseUrl: server.url, directory: workingDirectory })
    : client;
  return {
    // Single localized cast at the SDK boundary: the real `OpencodeClient`
    // exposes far more than `OpenCodeClientLike`, but is structurally a
    // superset for the two calls we make.
    client: scopedClient as unknown as OpenCodeClientLike,
    close: () => server.close(),
  };
};

/**
 * Create a `@langwatch/scenario` agent adapter that drives **opencode**
 * (sst/opencode) via `@opencode-ai/sdk`.
 *
 * **No separate server process to manage.** The adapter auto-spawns
 * `opencode serve` for you through the SDK on first use and tears it down via
 * the returned server's `close`. You only need the `opencode` binary installed
 * and on PATH.
 *
 * **Credentials are not injected by this adapter.** opencode resolves provider
 * credentials from its own configuration: run `opencode auth login`, or set the
 * provider's environment variables (e.g. `ANTHROPIC_API_KEY`) before the run.
 * The adapter passes only the `model` selector through.
 *
 * **Stateful sessions.** opencode keeps conversation history server-side. This
 * adapter opens exactly one opencode session per scenario `threadId` and reuses
 * it across turns, sending only the latest user message each turn. Contrast
 * with the Claude Code adapter, which is stateless and replays the full history
 * on every turn.
 *
 * @param model - Required `{ providerID, modelID }` selector, e.g.
 *   `{ providerID: "anthropic", modelID: "claude-haiku-4-5" }`.
 * @param workingDirectory - Optional directory opencode should operate in;
 *   when set, a directory-scoped client is bound to the spawned server.
 * @param startServer - Optional injected server starter (for tests); defaults
 *   to spawning a real opencode server via the SDK.
 *
 * @example
 * ```typescript
 * const agent = createOpenCodeAgent({
 *   model: { providerID: "anthropic", modelID: "claude-haiku-4-5" },
 *   workingDirectory: "/tmp/my-task",
 * });
 * ```
 */
export function createOpenCodeAgent({
  model,
  workingDirectory,
  startServer = defaultStartServer,
}: {
  model: OpenCodeModel;
  workingDirectory?: string;
  startServer?: (opts: {
    workingDirectory?: string;
  }) => Promise<OpenCodeServerHandle>;
}): AgentAdapter {
  // Lazily start the server once and memoize the handle for the run's lifetime.
  let started: Promise<OpenCodeServerHandle> | null = null;
  const ensureServer = () => (started ??= startServer({ workingDirectory }));

  // One opencode session id per scenario thread.
  const sessionByThread = new Map<string, string>();

  return {
    role: AgentRole.AGENT,
    call: async (input: AgentInput) => {
      const { client } = await ensureServer();

      let sessionId = sessionByThread.get(input.threadId);
      if (!sessionId) {
        const created = await client.session.create({
          body: { title: `scenario:${input.threadId}` },
        });
        if (!created.data?.id) {
          throw new Error("opencode session.create returned no session id");
        }
        sessionId = created.data.id;
        sessionByThread.set(input.threadId, sessionId);
      }

      const promptText = latestUserText(input);

      // Awaiting `session.prompt` is true completion: opencode resolves it only
      // once the assistant turn is fully generated, mirroring the Claude Code
      // adapter's "await the process exit" semantics.
      const result = await client.session.prompt({
        path: { id: sessionId },
        body: { model, parts: [{ type: "text", text: promptText }] },
      });

      return partsToText(result.data?.parts);
    },
  };
}
