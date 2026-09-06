/**
 * Why the generated OpenAPI document leaves certain mounted routes out. A list
 * rather than a check: the gate audits against it.
 */

/**
 * Why a route is absent from the published document. `internal`, `alias` and
 * `elsewhere` are permanent answers, `gap` is a debt that should shrink.
 */
export type AbsenceCategory =
  /** Not a customer-callable API. It must never appear in the reference. */
  | "internal"
  /** A retired or aliased path kept alive for older clients. */
  | "alias"
  /**
   * Public and deliberately documented somewhere other than the API
   * reference, because an OpenAPI operation is the wrong shape for it: the
   * contract belongs to someone else (OTLP), or the useful documentation is a
   * guide rather than a request schema.
   */
  | "elsewhere"
  /** A public endpoint that genuinely should be documented and is not yet. */
  | "gap";

export interface Exclusion {
  /**
   * `METHOD /path/{template}`, or a bare `/prefix` matching everything
   * beneath it. Spelled at the address the DOCUMENT uses: a family carrying a
   * `/api/v1` alias publishes there (ADR 002), so its entry names `/api/v1`.
   */
  match: string;
  category: AbsenceCategory;
  why: string;
}

/**
 * Every mounted route that the generated document deliberately omits. Adding
 * an entry claims a reader of the API reference is better off without the
 * route; for a `gap` that claim is temporary.
 */
export const UNPUBLISHED = [
  // ── Internal: the app talking to itself ────────────────────────────────
  {
    match: "/api/auth",
    category: "internal",
    why: "session and OAuth callback endpoints served by Better Auth; the contract is the flows themselves and the browser is the only intended caller",
  },
  {
    match: "/api/v1/auth/cli",
    category: "internal",
    why: "the CLI device flow and the calls the signed-in CLI makes with the token it minted. The contract is RFC 8628 plus the CLI's own commands, and a browser session or a device token is the only credential that reaches it",
  },
  {
    match: "/api/health",
    category: "internal",
    why: "liveness probes for the deployment, not a product capability",
  },
  {
    match: "/api/v1/openapi.json",
    category: "internal",
    why: "serves the document itself: an operation inside the document describing where to fetch that same document is circular, and a reader holding it has already answered the question",
  },
  {
    match: "/api/gateway/v1/openapi.json",
    category: "internal",
    why: "serves the gateway's own spec document, so it is the reference rather than an entry in it",
  },
  {
    match: "/.well-known/openapi",
    category: "internal",
    why: "the well-known discovery alias of the document, circular for the same reason the document's own path is",
  },
  {
    match: "/llms.txt",
    category: "internal",
    why: "the llms.txt discovery file an agent fetches to find the API; prose about the API rather than an operation in it",
  },
  {
    match: "/api/v1/image-proxy",
    category: "internal",
    why: "egress-guarded image fetch for rendering trace attachments in the dashboard",
  },
  {
    match: "/api/v1/user-avatar",
    category: "internal",
    why: "avatar image bytes for the dashboard, not a data API",
  },
  {
    match: "/api/v1/files",
    category: "internal",
    why: "signed-URL redirect for stored objects; callers reach files through the link the owning resource hands them",
  },
  {
    match: "/api/v1/bug-reports",
    category: "internal",
    why: "in-app report form intake",
  },
  {
    match: "/api/v1/unsubscribe",
    category: "internal",
    why: "RFC 8058 one-click unsubscribe, addressed by mail clients from a link we send",
  },
  {
    match: "/api/v1/dataset/generate",
    category: "internal",
    why: "LLM-backed dataset generation for the dataset editor, streaming UI-shaped partial state",
  },
  {
    match: "/api/v1/scenario/generate",
    category: "internal",
    why: "LLM-backed scenario drafting for the scenario editor, same UI-shaped streaming as dataset generation",
  },
  {
    match: "/api/v1/workflows/code-completion",
    category: "internal",
    why: "editor autocomplete for the Optimization Studio code node",
  },
  {
    match: "/api/v1/workflows/post_event",
    category: "internal",
    why: "the studio's own execution event channel, carrying workbench state rather than a public run contract",
  },
  {
    match: "/api/v1/playground",
    category: "internal",
    why: "backs the in-app model playground and takes whatever the playground UI currently sends",
  },
  {
    match: "/api/v1/ops",
    category: "internal",
    why: "operator debugging (ClickHouse EXPLAIN), reachable only with ops credentials",
  },
  {
    match: "/api/v1/internal",
    category: "internal",
    why: "control-plane calls from the gateway and langy workers, authenticated by an internal shared secret",
  },
  {
    match: "/api/v1/mcp/authorize",
    category: "internal",
    why: "one step of the MCP OAuth flow, driven by the MCP client rather than called directly",
  },
  {
    match: "/api/v1/webhooks/auth0-scim",
    category: "internal",
    why: "inbound Auth0 provisioning webhook, addressed by Auth0 and no one else",
  },
  {
    match: "/api/v1/github",
    category: "internal",
    why: "the GitHub App install redirect, setup callback and webhook. The redirect runs on a browser session from our own settings page, and the other two are addressed by GitHub, so an API-key caller can reach none of them",
  },
  {
    match: "/api/v1/github-langy",
    category: "internal",
    why: "the older spelling of the same setup callback and webhook, mounted on the same handlers because the GitHub App's configuration still delivers to it",
  },
  {
    match: "/api/v1/langy/ui",
    category: "internal",
    why: "the live UI-action channel between a Langy worker and the user's open browser tab. It only answers mid-turn, for the conversation the caller's own session key was minted for, and the payload contract is the in-repo action manifest rather than a stable public schema",
  },
  {
    match: "POST /api/v1/experiments/execute",
    category: "internal",
    why: "browser-session authenticated and streams workbench UI state; an API-key caller cannot reach it, and POST /api/v1/experiments/{slug}/run is the documented equivalent",
  },
  {
    match: "POST /api/v1/experiments/abort",
    category: "internal",
    why: "the stop button next to execute, session authenticated for the same reason",
  },
  // A versioned family answers each of its endpoints at three addresses — the
  // bare one, every dated one, and `latest` — and the audit counts all three,
  // so an unpublished endpoint of one needs an entry per address.
  {
    match: "POST /api/v1/experiments/2026-08-07/execute",
    category: "internal",
    why: "the dated address of the same session-authenticated workbench execute; the version namespace does not make it callable with an API key",
  },
  {
    match: "POST /api/v1/experiments/latest/execute",
    category: "internal",
    why: "the `latest` address of the same session-authenticated workbench execute",
  },
  {
    match: "POST /api/v1/experiments/2026-08-07/abort",
    category: "internal",
    why: "the dated address of the stop button next to execute",
  },
  {
    match: "POST /api/v1/experiments/latest/abort",
    category: "internal",
    why: "the `latest` address of the stop button next to execute",
  },
  {
    match: "POST /api/v1/export/scenario-runs/download",
    category: "internal",
    why: "the dashboard's download button for scenario runs, authenticated by a browser session rather than an API key",
  },
  {
    match: "/api/rum/v1",
    category: "internal",
    why: "the real-user-monitoring beacon the dashboard's own bundle posts. The payload is whatever this release of the browser bundle emits, and nothing outside it is a caller",
  },

  // ── Aliases: older paths kept working ──────────────────────────────────
  {
    match: "/api/v1/trace",
    category: "alias",
    why: "the singular spelling of the trace read, search and share endpoints, superseded by /api/v1/traces; documenting it would publish the paths we are moving clients off",
  },
  {
    match: "GET /api/v1/thread/{id}",
    category: "alias",
    why: "superseded by the trace endpoints under /api/v1/traces",
  },
  {
    match: "POST /api/track_event",
    category: "alias",
    why: "the original spelling of the tracked-event intake, kept alive for SDKs that still post to it; POST /api/v1/events/track is the documented equivalent",
  },
  // The two wildcard re-dispatchers. Each terminates nothing: it rewrites a
  // path a misconfigured client produced and forwards into the canonical
  // family, which is what authenticates and answers. There is no operation to
  // describe — the operation is the one they forward to.
  {
    match: "ALL /api/evaluations/v3/*",
    category: "alias",
    why: "the experiments family's older name, forwarded into /api/experiments; the documented operations are that family's own",
  },
  {
    match: "ALL /api/v1/otel/*",
    category: "alias",
    why: "OTLP path canonicalisation: an exporter that appended the wrong suffix is rewritten onto the canonical OTLP route rather than answering the SPA shell with a 200 it reads as success",
  },
  {
    match: "ALL /api/v1/collector/*",
    category: "alias",
    why: "the same canonicalisation for exporters aimed at the SDK collector's namespace",
  },
  {
    match: "ALL /api/v1/*",
    category: "alias",
    why: "the same canonicalisation for a root-level OTLP path under /api/v1. It matches only what canonicalOtlpPath recognises and otherwise declines, so it shadows no sibling family",
  },
  {
    match: "ALL /v1/*",
    category: "alias",
    why: "the same canonicalisation for the bare /v1 OTLP paths an exporter produces when it is given the host with no base path",
  },

  // ── Elsewhere: public, documented outside the API reference ────────────
  {
    match: "POST /api/v1/collector",
    category: "elsewhere",
    why: "the SDK trace ingestion path. Its contract is the span payload the SDKs build for you, and the integration guides are where a reader needs to meet it; an operation listing 40 span fields answers a question nobody asks here",
  },
  {
    match: "/api/otel/v1",
    category: "elsewhere",
    why: "OTLP/HTTP receivers. The contract is OpenTelemetry's protobuf, which an OpenAPI operation describes poorly; the integration docs point at the OTLP spec instead",
  },
  {
    match: "/api/v1/ingest",
    category: "elsewhere",
    why: "AI Governance source receivers, addressed with a per-source ingestion key. Documented today in the governance sources guide rather than the API reference",
  },
  {
    match: "/api/ingest",
    category: "elsewhere",
    why: "the OTLP signal paths of the same governance receivers, which an ingesting collector addresses with the OTLP suffix it appends itself",
  },

  // ── Gap: public, should be documented, not yet ─────────────────────────
  {
    match: "POST /api/v1/langy/conversations",
    category: "gap",
    why: "the key-authed Langy turn surface ships dark behind release_langy_api_key_turns_enabled, which defaults off. A caller who authenticates correctly gets 404 rather than a turn, so publishing it now would document an operation nobody reading the reference can successfully call. Describe the operation and delete this entry when the flag defaults on (#6821)",
  },
  {
    match: "POST /api/v1/langy/conversations/{conversationId}/messages",
    category: "gap",
    why: "the continuation half of the same dark surface: an authenticated caller reaches the same flag check and the same 404, and it becomes publishable on the same trigger (#6821)",
  },
] as const satisfies readonly Exclusion[];
