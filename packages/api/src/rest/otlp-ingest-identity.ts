/**
 * The door for an OTLP exporter's key (ARCHITECTURE.md §8, Alex 2026-10-10 W02-DOOR-SHAPE): it
 * reads the presented headers, asks the owning module who holds them, and puts that actor, project
 * and resolution on the request before the body is read. The owner keeps the header precedence.
 */
import type { Actor } from "@langwatch/authorization";

import { SurfaceUnconfiguredError } from "../errors.ts";
import type { RestCaller, RestIdentity } from "../hosting/api-door.ts";
import { collectAuthDiagnostics, type AuthDiagnostics } from "./security.ts";

/** What the exporter presented, unparsed, and the fingerprint a refusal is logged with. */
export type OtlpIngestPresented = Readonly<{
  authorization: string | null;
  xAuthToken: string | null;
  xProjectId: string | null;
  diagnostics: AuthDiagnostics;
}>;

/** Who the owner says holds the key; `session` is handed on for the route to parse. */
export type OtlpIngestHolder = Readonly<{
  actor: Actor | null;
  projectId: string;
  session: unknown;
}>;

export class OtlpIngestIdentity implements RestIdentity {
  readonly #verify: (presented: OtlpIngestPresented) => Promise<OtlpIngestHolder>;

  private constructor(options: Parameters<typeof OtlpIngestIdentity.create>[0]) {
    this.#verify = options.verify;
  }

  static create(options: {
    verify: (presented: OtlpIngestPresented) => Promise<OtlpIngestHolder>;
  }): OtlpIngestIdentity {
    return new OtlpIngestIdentity(options);
  }

  /** The door of a family no module bound an OTLP ingest key for: it lets nobody in. */
  static unbound(namespace: string): RestIdentity {
    const refuse = (): never => {
      throw new SurfaceUnconfiguredError(`${namespace} OTLP ingest key`);
    };

    return { authenticate: refuse, identify: refuse };
  }

  authenticate({ request }: { request: Request }): Promise<RestCaller> {
    return this.identify({ request });
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    const header = (name: string): string | undefined => request.headers.get(name) ?? undefined;
    const holder = await this.#verify({
      authorization: request.headers.get("authorization"),
      xAuthToken: request.headers.get("x-auth-token"),
      xProjectId: request.headers.get("x-project-id"),
      diagnostics: collectAuthDiagnostics({
        path: new URL(request.url).pathname,
        method: request.method,
        header,
      }),
    });

    return {
      actor: holder.actor,
      scope: { tier: "project", id: holder.projectId },
      session: holder.session,
    };
  }
}
