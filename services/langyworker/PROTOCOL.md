# langy-worker stdio protocol (version 1)

The langyagent manager spawns one `langy-worker` process per worker and talks to
it over stdin/stdout. Both directions are JSONL: one JSON object per line, LF as
the only record delimiter (strip a trailing CR if present; do not split on
U+2028/U+2029). stdout carries protocol lines ONLY. All logging goes to stderr.

## Process contract

- The manager sets `HOME` to the worker home and writes `$HOME/.langy-worker.json`
  (see Config below) and `$HOME/AGENTS.md` before spawn. Secrets travel only in
  environment variables; the config file references env var NAMES.
- The wrapper emits `{"type":"ready","protocol":1,"resumed":<bool>}` exactly
  once, after the pi session is constructed. `resumed` is true when the wrapper
  continued a persisted session its home still held (the home outlives the
  process on an idle reap or a crash); the manager then skips the transcript
  seed, since the session's own history is the single copy of the conversation.
  A resumed wrapper also ignores a turn's `resumeToken` for the same reason.
  Commands received before `ready` are valid and are processed in order.
- The wrapper never writes anything to stdout that is not a protocol line, and
  never exits between a turn's start and its terminal line: the terminal line is
  flushed to the pipe before anything else can happen.
- Unparseable or unknown stdin lines are ignored with a warning on stderr.
- stdin EOF means the manager is gone: an in-flight turn is aborted (its
  `turn_done` aborted terminal is still emitted and flushed), then the process
  exits 0.
- `langy-worker --version` prints the package version to stdout and exits 0
  (no config, no session; used by the image smoke test).

## Commands (manager -> wrapper)

```json
{"type":"turn","turnId":"t1","prompt":"...","system":"...","resumeToken":"..."}
{"type":"abort","turnId":"t1"}
{"type":"shutdown_imminent","deadlineMs":1755800000000}
{"type":"ping"}
```

- `turn`: run one turn. `system` (optional) is appended to the session system
  prompt for this and following turns (the system prompt is recomposed as
  persona + AGENTS.md + this turn's `system` before every prompt).
  `resumeToken` (optional) is prepended to the prompt as a clearly labeled
  context seed. **A `turn` received while another turn is running aborts the
  running turn first**: the old turn reaches its `turn_done` aborted terminal
  before the new turn's `turn_started` is emitted.
- `abort`: abort the named turn. If `turnId` does not match the running turn
  (or nothing is running), the command is ignored. The aborted turn still
  terminates with `turn_done` outcome `aborted`.
- `shutdown_imminent`: the manager will kill the process by `deadlineMs`
  (unix ms). If a turn is in flight, the wrapper aborts the LLM call, builds a
  conversation digest (<= 64KB, newest messages kept, oldest truncated) and
  emits `handoff` as that turn's terminal. If no turn is in flight it is a
  no-op: the previous turn already reached its terminal and the session file
  holds the history.
- `ping`: answered with `pong` immediately, mid-turn included.

## Events (wrapper -> manager)

Lifecycle:

```json
{"type":"ready","protocol":1,"resumed":false}
{"type":"pong"}
```

Per turn, all tagged with the turn's `turnId`:

```json
{"type":"turn_started","turnId":"t1"}
{"type":"delta","turnId":"t1","text":"..."}
{"type":"reasoning","turnId":"t1","text":"..."}
{"type":"tool_start","turnId":"t1","id":"call_1","name":"bash","input":{"command":"ls"}}
{"type":"tool_update","turnId":"t1","id":"call_1","name":"bash","output":"partial output"}
{"type":"tool_end","turnId":"t1","id":"call_1","name":"bash","input":{"command":"ls"},"isError":false,"output":"full output"}
{"type":"plan","turnId":"t1","items":[{"content":"Find the slowest traces","status":"in_progress"}]}
```

Event payload shapes follow pi's native session events: `delta` and `reasoning`
carry `message_update` text/thinking deltas verbatim; `tool_*` carry
`tool_execution_*` fields (`toolCallId` -> `id`, `toolName` -> `name`,
`args` -> `input`, result text -> `output`). `tool_end.input` is replayed from
the matching `tool_start` (pi's end event does not carry args). `plan` is
emitted on every successful `todowrite` tool call with the full current list;
`status` is one of `pending`, `in_progress`, `completed`, `cancelled`.

Terminal (the LAST line ever emitted for a `turnId`; nothing follows it):

```json
{"type":"turn_done","turnId":"t1","outcome":"ok"}
{"type":"turn_done","turnId":"t1","outcome":"error","errorMessage":"..."}
{"type":"turn_done","turnId":"t1","outcome":"aborted"}
{"type":"handoff","turnId":"t1","seed":"<bounded conversation digest>"}
```

- `ok`: the prompt ran to completion.
- `error`: the run failed (provider error, tool crash, rejected prompt).
  `errorMessage` carries the cause when known.
- `aborted`: the turn was aborted (explicit `abort`, or preempted by a new
  `turn`). Also used when stdin closes mid-turn.
- `handoff`: terminal produced by `shutdown_imminent` instead of `turn_done`.
  `seed` is the digest the manager passes as `resumeToken` on the resumed turn.

## Invariants

1. **Terminal-last per turn.** Exactly one terminal (`turn_done` or `handoff`)
   per `turnId`, and no event for that `turnId` after it. Events that surface
   from the underlying session after the terminal are dropped.
2. **Terminal is never lost.** The terminal line is written through a single
   ordered writer and flushed (write callback observed) before the wrapper
   processes anything else or exits.
3. **New turn preempts.** `turn` while running == `abort` current + run new,
   in that order, with both turns' event streams correctly separated.
4. **Bounding.** Every `text`, `output`, `errorMessage` and serialized `input`
   field is capped at 1MB (1,048,576 bytes); oversized values are truncated
   with the marker `"\n[truncated by langy-worker]"` appended. `input` objects
   whose JSON form exceeds the cap are replaced by a truncated JSON string
   carrying the same marker. The canonical 8KB reduction stays on the Go side.
5. **Digest bound.** `handoff.seed` is at most 64KB.
6. **Process death mid-turn** (no terminal received, pipe EOF) must be mapped
   by the manager to its worker-stopped path, never to an agent error.

## Config: `$HOME/.langy-worker.json`

```ts
type LangyWorkerConfig = {
  model: {
    id: string;                                  // model id sent to the API
    api: "openai-completions" | "openai-responses" | "anthropic-messages";
    baseUrlEnv: string;                          // env var NAME holding the base URL (e.g. "OPENAI_BASE_URL")
    apiKeyEnv: string;                           // env var NAME holding the API key (e.g. "OPENAI_API_KEY")
    reasoning?: boolean;
    contextWindow?: number;                      // default 128000
    maxTokens?: number;                          // default 16384
    compat?: Record<string, unknown>;            // pi compat flags verbatim (supportsStore, supportsReasoningEffort, ...)
    // Any additional keys are passed through verbatim into the generated pi
    // model entry (name, headers, samplingParams, thinkingLevelMap, ...).
  };
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  personaPrompt: string;                         // first system-prompt section
  agentsFilePath: string;                        // absolute path, usually $HOME/AGENTS.md
  skillsDir?: string;                            // dir of <name>/SKILL.md skills for the `skill` tool
  sessionDir: string;                            // pi session JSONL storage dir
};
```

Example:

```json
{
  "model": {
    "id": "gpt-5-mini",
    "api": "openai-responses",
    "baseUrlEnv": "OPENAI_BASE_URL",
    "apiKeyEnv": "OPENAI_API_KEY",
    "reasoning": true,
    "contextWindow": 272000,
    "maxTokens": 32000,
    "compat": { "supportsStore": false }
  },
  "thinkingLevel": "medium",
  "personaPrompt": "You are Langy, the LangWatch assistant.",
  "agentsFilePath": "/home/langy/AGENTS.md",
  "skillsDir": "/home/langy/skills",
  "sessionDir": "/home/langy/sessions"
}
```

The wrapper turns `model` into a generated pi `models.json` under
`$HOME/.langy-pi/models.json` at boot: `baseUrl` is resolved from
`process.env[baseUrlEnv]` (boot fails and names it when unset), `apiKey` is written
as the env REFERENCE `"$<apiKeyEnv>"` so the secret never lands on disk, and
every other model key is passed through verbatim.
