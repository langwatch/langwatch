# fuzz

A generic, non-AI, highly parallel fuzzer for the LangWatch API and UI. It runs
against the one shared stack (`visualdiff-check`), seeds its own `fuzzer`
organisation through the public API (diffkit's org-per-tool helper), and never
restarts the stack or lowers a global limit.

```
go run ./cmd/fuzz api|ui|all [-seed N] [-workers N] [-duration D] [-only <area>] [-url URL]
```

- `api` (Go, this package): every operation in the branch OpenAPI document,
  valid bodies from the schema then mutation families across auth permutations.
- `ui` (TypeScript, another lane, under `tools/fuzz/runner`): a monkey over
  every registered route. The Go side execs it; see the protocol below.

Output lands in `.fuzz/<run>/`: `findings.jsonl`, `findings.md` (grouped),
`coverage.md`, and a timing block on stderr and in `timing.txt`.

## The oracles (no AI)

1. any 5xx response;
2. a 2xx response that is not the JSON its documented response schema declares;
3. a 2xx for input the request schema forbids (missing required, wrong type);
4. another tenant's data readable with the fuzzer's own key (cross-tenant);
5. a response slower than the latency cap;
6. a new error/fatal log signature during the run (diffkit log scanning).

Each finding is shrunk to a minimal reproducing request, written with its curl
line, and findings are grouped by signature so thousands of hits collapse to a
short list.

## UI protocol (Go writes plan.json, TS writes findings.jsonl)

The two halves agree by file, in the run directory `.fuzz/<run>/`:

### `plan.json` (Go writes, TS reads)

```json
{
  "runId": "20260930-120000",
  "url": "https://app.visualdiff-check.langwatch.localhost",
  "seed": 1,
  "workers": 16,
  "durationMs": 120000,
  "actionsPerRoute": 40,
  "only": "",
  "org": {
    "name": "fuzzer",
    "orgKey": "sk-lw-...",
    "projects": [{ "key": "sk-lw-...", "id": "project-..." }],
    "restricted": "sk-lw-...",
    "separate": true
  },
  "credential": {
    "email": "fuzzer-tool@mail.langwatch.localhost",
    "password": "..."
  }
}
```

### `findings.jsonl` (TS writes, one JSON object per line — same schema as the API half)

```json
{
  "oracle": "console-error|page-error|network-5xx|network-4xx|blank|error-boundary|nav-404|hang",
  "finding": true,
  "route": "/[project]/messages",
  "signature": "console-error :: TypeError: x is not a function",
  "message": "TypeError: x is not a function",
  "trail": ["goto /messages", "click button 'New'", "fill input#name 'fuzzer'"],
  "evidence": { "screenshot": "ui/0007.png", "url": "https://.../messages", "console": ["..."], "requests": ["GET /api/x 500"] },
  "capturedAt": "2026-09-30T12:00:07Z"
}
```

The last line is a run summary: `{"kind":"run-complete","total":N,"counts":{...},"routesExercised":M,"routesTotal":T,"capturedAt":"..."}`.

The TS runner reuses `tools/visualdiff/runner`'s sign-in and page settle by
import. The Go side signs its ceremony user up first (so the account exists) and
passes the credential in `plan.json`.
