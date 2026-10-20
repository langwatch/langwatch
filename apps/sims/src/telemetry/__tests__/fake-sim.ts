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
      const url = new URL(input, "http://telemetry.test");
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
  mode: "load",
  preset: "llm-trace",
  seed: 7,
  endpoint: "https://app.feat-x.langwatch.localhost/api/otel",
  encoding: "protobuf",
  gzip: true,
  state: "running",
  startedAt: "2026-10-09T10:00:00Z",
  targetRate: 5,
  sent: 50,
  acked: 45,
  refused: 4,
  failed: 1,
  retried: 3,
  late: 0,
  answers: { "200": 45, "415": 1, "429": 3, "503": 3 },
  retryAfterSeen: 6,
  lastRetryAfter: "2",
  latency: { samples: 52, p50: 12.5, p90: 40, p99: 88.2, max: 120 },
};

export const wireStatus = {
  stack: "feat-x",
  endpoint: "https://app.feat-x.langwatch.localhost/api/otel",
  keySource: "TELEMETRYSIM_API_KEY",
  keyHint: "sk-lw-…-key",
  project: "local-dev-org/local-dev-project",
  presets: ["llm-trace", "logs"],
  run: wireRun,
  recent: [{ ...wireRun, id: "run-1", mode: "send", state: "done", seed: 3, answers: {} }],
};
