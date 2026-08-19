/**
 * Why the published OpenAPI document leaves certain registered routes out.
 *
 * Its own module because it is a list rather than a check: the gate in
 * `check-openapi-route-coverage.ts` is discovery, audit and report, and this is
 * the standing editorial decision it audits against. Reviewing an added entry
 * means reading the reason next to the ones already there, which is easier when
 * they are all the file holds.
 */

/**
 * Why a route is absent from the published document. The category is not
 * decoration: `internal`, `alias` and `elsewhere` are permanent answers, `gap`
 * is a debt that should shrink, and keeping them apart is what stops the list
 * from quietly becoming a place to put anything inconvenient.
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
   * `METHOD /path/{template}`, or a bare `/prefix` matching every operation
   * beneath it. A prefix keeps a whole internal surface to one reviewable
   * entry rather than fifteen copies of the same sentence.
   */
  match: string;
  category: AbsenceCategory;
  why: string;
}

/**
 * Every registered route that the published document deliberately omits.
 *
 * Adding an entry is a claim that a reader of the API reference is better off
 * without this route. For `gap` entries that claim is temporary, and the fix is
 * always the same three steps from the docstring of
 * `check-openapi-route-coverage.ts`.
 */
export const UNPUBLISHED = [
  // ── Internal: the app talking to itself ────────────────────────────────
  {
    match: "/api/trpc",
    category: "internal",
    why: "the app's own tRPC transport; its contract is the TypeScript router, not an HTTP schema",
  },
  {
    match: "/api/sse",
    category: "internal",
    why: "server-sent event channels the dashboard subscribes to, with no stable per-message contract to publish",
  },
  {
    match: "/api/prompt-playground",
    category: "internal",
    why: "browser SSE stream for the prompt playground, with no stable per-message contract to publish",
  },
  {
    match: "/api/playground",
    category: "internal",
    why: "backs the in-app model playground and takes whatever the playground UI currently sends",
  },
  {
    match: "/api/cron",
    category: "internal",
    why: "scheduler-triggered jobs, authenticated by the cron secret rather than a customer credential",
  },
  {
    match: "/api/internal",
    category: "internal",
    why: "control-plane calls from the gateway and langy workers, authenticated by an internal shared secret",
  },
  {
    match: "/api/admin",
    category: "internal",
    why: "LangWatch staff back-office, including impersonation; publishing it would advertise a surface no customer may call",
  },
  {
    match: "/api/ops",
    category: "internal",
    why: "operator debugging (ClickHouse EXPLAIN), reachable only with ops credentials",
  },
  {
    match: "/api/health",
    category: "internal",
    why: "liveness probes for the deployment, not a product capability",
  },
  {
    match: "/api/auth",
    category: "internal",
    why: "session, OAuth callback and CLI device-flow endpoints; the contract is the flows themselves (RFC 8628 for the CLI), and the browser and CLI are the only intended callers",
  },
  {
    match: "/api/mcp/authorize",
    category: "internal",
    why: "one step of the MCP OAuth flow, driven by the MCP client rather than called directly",
  },
  {
    match: "/api/webhooks/stripe",
    category: "internal",
    why: "inbound Stripe webhook; the schema is Stripe's and the signature check makes us the only valid caller",
  },
  {
    match: "/api/webhooks/auth0-scim",
    category: "internal",
    why: "inbound Auth0 provisioning webhook, addressed by Auth0 and no one else",
  },
  {
    match: "/api/github",
    category: "internal",
    why: "the GitHub App install redirect, setup callback and webhook. The redirect runs on a browser session from our own settings page, and the other two are addressed by GitHub, so an API-key caller can reach none of them",
  },
  {
    match: "/api/track_usage",
    category: "internal",
    why: "anonymous self-hosted instance telemetry, posted by the instance itself",
  },
  {
    match: "/api/demo/hotel_bot",
    category: "internal",
    why: "scripted demo agent behind the sample project",
  },
  {
    match: "/api/image-proxy",
    category: "internal",
    why: "SSRF-guarded image fetch for rendering trace attachments in the dashboard",
  },
  {
    match: "/api/user-avatar",
    category: "internal",
    why: "avatar image bytes for the dashboard, not a data API",
  },
  {
    match: "/api/bug-reports",
    category: "internal",
    why: "in-app report form intake",
  },
  {
    match: "/api/unsubscribe",
    category: "internal",
    why: "RFC 8058 one-click unsubscribe, addressed by mail clients from a link we send",
  },
  {
    match: "/api/dataset/generate",
    category: "internal",
    why: "LLM-backed dataset generation for the dataset editor, streaming UI-shaped partial state",
  },
  {
    match: "/api/scenario/generate",
    category: "internal",
    why: "LLM-backed scenario drafting for the scenario editor, same UI-shaped streaming as dataset generation",
  },
  {
    match: "/api/workflows/code-completion",
    category: "internal",
    why: "editor autocomplete for the Optimization Studio code node",
  },
  {
    match: "/api/workflows/post_event",
    category: "internal",
    why: "the studio's own execution event channel, carrying workbench state rather than a public run contract",
  },
  {
    match: "/api/files",
    category: "internal",
    why: "signed-URL redirect for stored objects; callers reach files through the link the owning resource hands them",
  },
  {
    match: "/api/gateway/v1/openapi.json",
    category: "internal",
    why: "serves the gateway's own spec document, so it is the reference rather than an entry in it",
  },
  {
    match: "POST /api/experiments/execute",
    category: "internal",
    why: "browser-session authenticated and streams workbench UI state; an API-key caller cannot reach it, and POST /api/experiments/{slug}/run is the documented equivalent",
  },
  {
    match: "POST /api/experiments/abort",
    category: "internal",
    why: "the stop button next to execute, session authenticated for the same reason",
  },

  {
    match: "POST /api/export/traces/download",
    category: "internal",
    why: "the dashboard's download button, authenticated by a browser session rather than an API key. An API-key holder cannot reach it; /api/traces/search is the programmatic equivalent",
  },
  {
    match: "POST /api/export/scenario-runs/download",
    category: "internal",
    why: "the dashboard's download button for scenario runs, session-authenticated in the same way as the trace export",
  },
  // ── Aliases: older paths kept working ──────────────────────────────────
  {
    match: "/api/github-langy",
    category: "alias",
    why: "the older spelling of the setup callback and webhook, mounted on the same handlers because the GitHub App's configuration still delivers to it",
  },
  {
    match: "/api/evaluations/v3",
    category: "alias",
    why: "deprecated alias that rewrites onto /api/experiments/...; documenting it would publish the path we are moving clients off",
  },
  {
    match: "GET /api/thread/{id}",
    category: "alias",
    why: "superseded by the trace endpoints under /api/traces",
  },

  // ── Elsewhere: public, documented outside the API reference ────────────
  {
    match: "POST /api/collector",
    category: "elsewhere",
    why: "the SDK trace ingestion path. Its contract is the span payload the SDKs build for you, and the integration guides are where a reader needs to meet it; an operation listing 40 span fields answers a question nobody asks here",
  },
  {
    match: "/api/otel/v1",
    category: "elsewhere",
    why: "OTLP/HTTP receivers. The contract is OpenTelemetry's protobuf, which an OpenAPI operation describes poorly; the integration docs point at the OTLP spec instead",
  },
  {
    match: "/api/ingest",
    category: "elsewhere",
    why: "AI Governance source receivers, addressed with a per-source ingestion key. Documented today in the governance sources guide rather than the API reference",
  },

  {
    match: "GET /api/openapi.json",
    category: "elsewhere",
    why: "serves the document itself, for the same reason /api/gateway/v1/openapi.json above is absent: an operation inside the document describing where to fetch that same document is circular, and a reader holding it has already answered the question",
  },

  // ── Gap: public, should be documented, not yet ─────────────────────────
  {
    match: "POST /api/langy/conversations",
    category: "gap",
    why: "the key-authed Langy turn surface ships dark behind release_langy_api_key_turns_enabled, which defaults off. A caller who authenticates correctly gets 404 rather than a turn — the refusals before the flag check (401 on a missing or invalid token, 403 on a key whose owner has no Langy access) are the only other answers it gives — so publishing it now would document an operation nobody reading the reference can successfully call. Describe the operation and delete this entry when the flag defaults on (#6821)",
  },
  {
    match: "POST /api/langy/conversations/{conversationId}/messages",
    category: "gap",
    why: "the continuation half of the same dark surface: an authenticated caller reaches the same flag check and the same 404, and it becomes publishable on the same trigger (#6821)",
  },
  {
    match: "POST /api/rpc.discover",
    category: "gap",
    why: "the RPC catalogue, a projection of this document filtered to dotted operations. It should be published once a family actually adopts RPC naming and the catalogue stops being empty — describing an operation whose response is always `{operations: []}` teaches a reader nothing",
  },
] as const satisfies readonly Exclusion[];
