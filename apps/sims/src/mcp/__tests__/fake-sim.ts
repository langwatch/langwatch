import { vi } from "vitest";

export type Call = { method: string; path: string; body: unknown };

export const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes are keyed `METHOD /path`; every call is kept so a test can read what the console sent. */
export const fakeSim = ({ routes }: { routes: Record<string, () => Response> }) => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://mcp.test");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname, body });
      const route = routes[`${method} ${url.pathname}`];
      return route ? route() : json({ body: { error: "not_found" }, status: 404 });
    }),
  );
  return calls;
};

export const wireRun = {
  id: "run-2",
  scenario: "soak",
  flow: "oauth",
  client: "claude-code",
  endpoint: "https://app.feat-x.langwatch.localhost",
  transports: ["/mcp"],
  state: "failed",
  startedAt: "2026-10-09T10:00:00Z",
  finishedAt: "2026-10-09T10:01:00Z",
  durationMs: 60_000,
  steps: [
    {
      at: "2026-10-09T10:00:01.123Z",
      kind: "initialize",
      flow: "oauth",
      transport: "/mcp",
      method: "POST",
      url: "https://app.feat-x.langwatch.localhost/api/mcp",
      status: 503,
      latencyMs: 41.5,
      ok: false,
      session: "ab12…",
      error: "service unavailable",
    },
  ],
  checks: [
    { name: "session survives a refresh", pass: true },
    { name: "no dropped streams", pass: false, detail: "stream dropped after 12s" },
  ],
  load: {
    clients: 10,
    sessions: 10,
    requests: 400,
    errors: 3,
    reinitialized: 2,
    refreshed: 4,
    retried: 5,
    answers: { "200": 392, "503": 5 },
    latency: { samples: 400, p50: 12.5, p90: 40, p99: 88.2, max: 120 },
  },
};

export const wireStatus = {
  stack: "feat-x",
  endpoint: "https://app.feat-x.langwatch.localhost",
  keySource: "MCPSIM_API_KEY",
  keyHint: "sk-lw-…-key",
  projectId: "project_1",
  callbackUrl: "http://localhost:5598/callback",
  autoApprove: "cookie",
  oauth: {
    connected: true,
    clientId: "client_1",
    accessHint: "lw_at…1234",
    refreshHint: "lw_rt…5678",
    refreshes: 2,
  },
  scenarios: [
    { name: "connect", summary: "connect", flows: ["apikey", "oauth"] },
    { name: "refresh", summary: "refresh", flows: ["oauth"] },
    { name: "soak", summary: "soak", flows: ["apikey", "oauth"] },
    { name: "oauth-connect", summary: "oauth-connect", flows: ["oauth"] },
  ],
  runs: [{ ...wireRun, steps: [], checks: [], load: null }],
};
