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
      const url = new URL(input, "http://outbound.test");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname, body });
      const route = routes[`${method} ${url.pathname}`];
      return route ? route() : json({ body: { error: "not_found" }, status: 404 });
    }),
  );
  return calls;
};

export const status = () =>
  json({ body: { stack: "feat-x", records: 3, baseUrl: "http://outbound.test" } });
