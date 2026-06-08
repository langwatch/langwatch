/**
 * Emit codex turn input/output (recovered from the rollout transcript) as OTLP
 * spans on codex's own per-turn trace_ids, so they join the native token-spans
 * and the trace summary's computed input/output populate with no receiver
 * change. See codex-rollout.ts for why the transcript is the only content
 * source codex offers.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CodexTurnIO, parseCodexRollout } from "./codex-rollout";

/** Deterministic 16-hex span id derived from the turn's trace_id. */
function ioSpanId(traceId: string): string {
  return createHash("sha256").update(`${traceId}:langwatch.io`).digest("hex").slice(0, 16);
}

function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

interface OtlpExportRequest {
  resourceSpans: unknown[];
}

/**
 * Build an OTLP/JSON ExportTraceServiceRequest with one span per turn. Each
 * span rides codex's real trace_id and carries `langwatch.input` /
 * `langwatch.output` (read directly by the trace-summary IO accumulation) plus
 * `langwatch.span.type=llm` so the drawer renders it as the model response.
 *
 * `langwatch.input` is the full request body as the LangWatch structured
 * `chat_messages` envelope (system prompt + accumulated conversation + tool
 * calls). The receiver's `parseJsonStringValues` step parses the JSON string
 * into the `{ type, value }` object, and the LangWatch extractor canonicalises
 * it to `gen_ai.input.messages` + `gen_ai.system_instructions`, so the drawer
 * renders the same full conversation a claude trace does.
 */
export function buildCodexIOExportRequest(
  turns: CodexTurnIO[],
  nowMs: number,
): OtlpExportRequest {
  const spans = turns.map((turn) => {
    const startMs = turn.startedAtMs ?? nowMs;
    const endMs = Math.max(startMs, nowMs);
    const attributes = [
      attr("langwatch.span.type", "llm"),
      attr(
        "langwatch.input",
        JSON.stringify({ type: "chat_messages", value: turn.inputMessages }),
      ),
      attr("langwatch.output", turn.output),
    ];
    if (turn.model) {
      attributes.push(attr("gen_ai.request.model", turn.model));
      attributes.push(attr("gen_ai.response.model", turn.model));
    }
    return {
      traceId: turn.traceId,
      spanId: ioSpanId(turn.traceId),
      name: "codex.turn.response",
      kind: 1,
      startTimeUnixNano: `${startMs}000000`,
      endTimeUnixNano: `${endMs}000000`,
      attributes,
      status: {},
    };
  });

  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "codex")] },
        scopeSpans: [
          {
            // A langwatch.* scope (NOT codex_cli_rs) so the ingestion
            // infra-span filter leaves these content spans alone.
            scope: { name: "langwatch.codex.rollout" },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * Find rollout files codex wrote at or after `sinceMs`. Codex lays them out as
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionid>.jsonl; we walk the
 * date subdirs and keep files whose mtime is within the session window.
 */
export async function findRecentRollouts(
  sinceMs: number,
  sessionsRoot = join(homedir(), ".codex", "sessions"),
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        // Year/month/day nesting is 3 deep; don't descend forever.
        if (depth < 3) await walk(full, depth + 1);
      } else if (
        e.isFile() &&
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl")
      ) {
        try {
          const s = await stat(full);
          if (s.mtimeMs >= sinceMs) out.push(full);
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(sessionsRoot, 0);
  return out;
}

/**
 * Recover codex turn I/O from rollouts written during this session and POST it
 * as OTLP spans. Best-effort and fully swallowed: a coding session must never
 * fail because the post-hoc content harvest hit a snag. Returns the number of
 * turns emitted (0 when nothing was found).
 */
export async function harvestAndEmitCodexIO(args: {
  sinceMs: number;
  nowMs: number;
  endpoint: string;
  token: string;
  sessionsRoot?: string;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const { sinceMs, nowMs, endpoint, token, sessionsRoot, fetchImpl } = args;
  const files = await findRecentRollouts(
    sinceMs,
    sessionsRoot ?? join(homedir(), ".codex", "sessions"),
  );
  if (files.length === 0) return 0;

  const turns: CodexTurnIO[] = [];
  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      turns.push(...parseCodexRollout(content));
    } catch {
      /* skip unreadable rollout */
    }
  }
  if (turns.length === 0) return 0;

  const body = buildCodexIOExportRequest(turns, nowMs);
  const doFetch = fetchImpl ?? fetch;
  // Cap the POST so a slow or unreachable endpoint can't wedge the user's
  // shell after codex has already exited.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  return turns.length;
}
