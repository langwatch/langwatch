import { vi } from "vitest";

export type DaemonCall = { method: string; path: string; body: unknown };
export type DaemonReply = { status?: number; body: unknown };

const bodyOf = ({ init }: { init: RequestInit | undefined }): unknown =>
  typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

/** Stands in for the daemon behind `fetch`: `answer` maps a call to a reply, else a 404. */
export const stubDaemon = ({ answer }: { answer: (call: DaemonCall) => DaemonReply | undefined }) => {
  const calls: DaemonCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const call = { method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body: bodyOf({ init }) };
      calls.push(call);
      const reply = answer(call) ?? { status: 404, body: { error: `no fixture for ${call.path}` } };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { calls };
};
