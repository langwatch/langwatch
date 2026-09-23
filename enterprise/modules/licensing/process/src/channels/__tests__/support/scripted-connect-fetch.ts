import type { ConnectFetch } from "../../http/http.connect-host.channel.ts";

/** What one request carried, as the host would have read it. */
export type SentRequest = Readonly<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}>;

type Reply =
  | { kind: "answer"; status: number; body: unknown }
  | { kind: "unparseable"; status: number }
  | { kind: "unreachable" };

/** A host that answers every request the one way it was scripted to, and records it. */
export class ScriptedConnectHost {
  readonly sent: SentRequest[] = [];
  #reply: Reply = { kind: "unreachable" };

  answers(status: number, body: unknown): this {
    this.#reply = { kind: "answer", status, body };
    return this;
  }

  answersWithAPage(status: number): this {
    this.#reply = { kind: "unparseable", status };
    return this;
  }

  cannotBeReached(): this {
    this.#reply = { kind: "unreachable" };
    return this;
  }

  readonly fetch: ConnectFetch = async (url, init) => {
    this.sent.push({
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const reply = this.#reply;
    if (reply.kind === "unreachable") throw new Error("ECONNREFUSED");
    if (reply.kind === "unparseable") {
      return { status: reply.status, json: () => Promise.reject(new SyntaxError("not json")) };
    }
    return { status: reply.status, json: async () => reply.body };
  };
}

/** A refusal the way the hosted gateway nests it. */
export function gatewayRefusal(code: string, meta?: Record<string, unknown>) {
  return {
    error: {
      type: code,
      code,
      message: `the host refused with ${code}`,
      ...(meta ? { meta } : {}),
    },
  };
}

/** A refusal in the standard REST body the connect host answers. */
export function hostRefusal(code: string) {
  return { type: code, code, message: `the host refused with ${code}` };
}
