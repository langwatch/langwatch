/**
 * One entry on `langy.onTurnStream`, as both sides of the wire read it.
 *
 * THE TYPE IS THE WIRE, and the wire has two ends: the worker's token buffer
 * writes these, and the browser's chat transport bridges them into the chunk
 * stream `useChat` reads. It was declared in `@langwatch/langy-server`'s token
 * buffer, which is where the ENCODING belongs and not where the SHAPE does — a
 * browser package may not import a server one even for a type, so the Langy
 * dock could not name the entries it decodes.
 *
 * DECLARED HERE, AND THE SERVER'S OWN COPY STILL STANDS. Repointing the token
 * buffer at this module is a `packages/features/langy/server` edit, which the
 * slice that moved the dock was not allowed to make; until someone does, the
 * two declarations must be kept in step by hand, exactly as
 * `@langwatch/enterprise-billing-contract` says of its Prisma enum copies. The
 * server's is `streaming/langy-token-buffer.ts`.
 *
 * `delta` carries buffered tokens; `status`/`progress` are ephemeral live-only
 * ticks; `milestone` mirrors a durable milestone to the live UI (the durable
 * event is dispatched separately); `end`/`error` are terminal markers the
 * reader stops on.
 */

import type { CliResultDigest } from "./cards/digest";
import type { CliToolResult } from "./cards/tool-result";

export type LangyStreamEntry =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "status"; status: string }
  | {
      type: "progress";
      message?: string;
      progress?: number;
      current?: number;
      total?: number;
      batchItems?: number;
      batchDurationMs?: number;
    }
  | { type: "milestone"; kind: string; detail?: string }
  /**
   * A full snapshot of the agent's plan (todo list), mirrored to the live UI as
   * a checklist. Ephemeral on this buffer — the durable `plan_updated` event is
   * dispatched separately; the client prefers this typed snapshot over parsing
   * the raw `todowrite` tool part.
   */
  | { type: "plan"; items: Array<{ content: string; status: string }> }
  /**
   * A tool call the agent ran, mirrored onto the live edge so the UI renders a
   * card as the tool starts and updates it when it returns. `phase:"start"`
   * carries the name + input; `phase:"end"` carries the result (`output`, a
   * string), `isError`, and — for a LangWatch CLI call — the result `digest`
   * the relay's envelope computed. The durable
   * `tool_call_started`/`tool_call_completed` events are dispatched separately.
   */
  | {
      type: "tool";
      id: string;
      name: string;
      phase: "start" | "end";
      title?: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
      digest?: CliResultDigest;
      result?: CliToolResult;
    }
  /**
   * The agent navigating the browser to a resource it surfaced. `href` is
   * ALWAYS platform-computed and already stripped to a same-app relative path —
   * never something the agent authored. LIVE-ONLY by design: never a durable
   * event, so reopening a past conversation never replays a navigation.
   */
  | { type: "navigate"; href: string }
  /**
   * The agent asking the OPEN PAGE to carry out one typed action. `kind` names
   * an entry in a page's action manifest and `payload` has already passed that
   * entry's schema server-side before it was appended. LIVE-ONLY like
   * `navigate`, and `actionId` is the server-minted claim/result key, which
   * makes the whole round trip at-most-once.
   */
  | { type: "ui"; actionId: string; kind: string; payload: unknown }
  | { type: "end" }
  | { type: "error"; error: string };
