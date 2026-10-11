import { z } from "zod";

import type { RequestState } from "../../api-reference/model/codegen.ts";
import { liveRequest } from "../../api-reference/model/codegen.ts";
import type { Operation } from "../../api-reference/model/operation.ts";
import { docsSessionTokenSchema, DocsSessionError } from "./token-provider.ts";
import type { DocsSessionToken, DocsTokenProvider } from "./token-provider.ts";

export const sessionViewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disconnected") }),
  z.object({ kind: z.literal("connecting") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("ready"), projectName: z.string(), expiresAt: z.number() }),
]);
export type SessionView = z.infer<typeof sessionViewSchema>;

export class DocsSessionController {
  #provider: DocsTokenProvider;
  #now: () => number;
  #credential: DocsSessionToken | null = null;
  #generation = 0;
  #expired = false;

  private constructor({ provider, now }: { provider: DocsTokenProvider; now: () => number }) {
    this.#provider = provider;
    this.#now = now;
  }

  static create({ provider, now = Date.now }: { provider: DocsTokenProvider; now?: () => number }) {
    return new DocsSessionController({ provider, now });
  }

  async connect({ signal }: { signal: AbortSignal }): Promise<void> {
    const generation = ++this.#generation;
    this.#credential = null;
    this.#expired = false;
    const value = await this.#provider.acquire({ signal });
    const parsed = docsSessionTokenSchema.safeParse(value);
    if (!parsed.success)
      throw new DocsSessionError({
        code: "invalid",
        message: "The session response was not valid.",
      });
    if (signal.aborted || generation !== this.#generation) {
      await this.#provider.revoke({ grantId: parsed.data.grantId });
      throw new DocsSessionError({ code: "cancelled", message: "Connection cancelled." });
    }
    const remaining = parsed.data.expiresAt - this.#now();
    if (remaining <= 0 || remaining > 300_000) {
      throw new DocsSessionError({
        code: "invalid",
        message: "The session expiry was not valid. Connect again.",
      });
    }
    this.#credential = parsed.data;
  }

  snapshot(): SessionView {
    if (this.#credential && this.#credential.expiresAt <= this.#now()) {
      this.#credential = null;
      this.#expired = true;
    }
    if (!this.#credential) return { kind: this.#expired ? "expired" : "disconnected" };
    return {
      kind: "ready",
      projectName: this.#credential.projectName,
      expiresAt: this.#credential.expiresAt,
    };
  }

  async disconnect(): Promise<void> {
    this.#generation += 1;
    const credential = this.#credential;
    this.#credential = null;
    this.#expired = false;
    if (credential) await this.#provider.revoke({ grantId: credential.grantId });
  }

  async send({
    operation,
    state,
    signal,
  }: {
    operation: Operation;
    state: RequestState;
    signal: AbortSignal;
  }): Promise<Response> {
    const view = this.snapshot();
    if (view.kind !== "ready" || !this.#credential) {
      throw new DocsSessionError({
        code: "expired",
        message: "Session ended. Connect again before sending a request.",
      });
    }
    const credential = this.#credential;
    assertTraceScope({ operation, credential });
    if (signal.aborted)
      throw new DocsSessionError({ code: "cancelled", message: "Request cancelled." });
    if (this.#provider.kind !== "mock") {
      throw new DocsSessionError({
        code: "unavailable",
        message: "Live session connections are not available yet.",
      });
    }
    const request = liveRequest({ operation, state, key: credential.token });
    return mockTraceResponse({ request, credential });
  }
}

function assertTraceScope({
  operation,
  credential,
}: {
  operation: Operation;
  credential: DocsSessionToken;
}) {
  const traceRead = operation.method === "GET" && operation.path === "/api/v1/traces/{traceId}";
  const trustedOrigin =
    operation.origin === "https://app.langwatch.ai" && credential.apiOrigin === operation.origin;
  if (!traceRead || !trustedOrigin || !credential.permissions.includes("traces:view")) {
    throw new DocsSessionError({
      code: "scope",
      message:
        "This session only supports the trace-reading demo. Use an API key for this endpoint.",
    });
  }
}

function mockTraceResponse({
  request,
  credential,
}: {
  request: { url: string; headers: Record<string, string> };
  credential: DocsSessionToken;
}) {
  const header = Object.entries(request.headers).find(
    ([name]) => name.toLowerCase() === "x-auth-token",
  );
  if (header?.[1] !== credential.token) {
    throw new DocsSessionError({
      code: "scope",
      message: "This endpoint does not support the demo session.",
    });
  }
  return new Response(
    JSON.stringify(
      {
        demo: true,
        message: "Simulated response. No request was sent to LangWatch.",
        project_id: credential.projectId,
        trace_id: decodeURIComponent(
          new URL(request.url).pathname.split("/").pop() ?? "demo-trace",
        ),
        spans: [],
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
