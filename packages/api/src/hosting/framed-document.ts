import { randomBytes } from "node:crypto";

import type { HttpTarget } from "./http-mux.ts";

/** A document a module builds for a sandboxed iframe, stamped with a fresh nonce per answer. */
export type FramedDocumentSelection = Readonly<{
  path: string;
  document: (options: { nonce: string }) => string;
}>;

/*
 * The frame runs customer code, so its policy replaces the app's: scripts only
 * under this answer's nonce, no navigation, no form submission, framed by this
 * origin alone. The mux floor fills only absent headers, so SAMEORIGIN holds.
 */
const FRAME_POLICY = [
  "default-src 'none'",
  "script-src https: blob: data: 'nonce-{nonce}' 'unsafe-eval'",
  "style-src https: blob: data: 'unsafe-inline'",
  "img-src https: blob: data:",
  "font-src https: blob: data:",
  "connect-src https: wss: blob: data:",
  "worker-src blob: https:",
  "child-src blob:",
  "media-src https: blob: data:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "sandbox allow-scripts",
].join("; ");

export class FramedDocument implements HttpTarget {
  static create(selection: FramedDocumentSelection): FramedDocument {
    return new FramedDocument(selection);
  }

  private constructor(private readonly selection: FramedDocumentSelection) {}

  fetch = (request: Request): Response => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const nonce = randomBytes(16).toString("base64");

    return new Response(this.selection.document({ nonce }), {
      status: 200,
      headers: {
        "Content-Security-Policy": FRAME_POLICY.replace("{nonce}", nonce),
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  };
}

/**
 * A module-built document a registered docs site embeds (ADR-185): the request's `origin`
 * names the embedder, which must be registered. It runs no customer code and no analytics.
 */
export type EmbeddedDocumentSelection = Readonly<{
  path: string;
  document: (options: { nonce: string; embedder: string }) => string;
  /** What an unregistered `origin` is answered with; nothing may frame it. */
  refusal: () => string;
}>;

/*
 * Only this answer's nonce runs and only this origin answers its requests. frame-ancestors
 * names the one embedder; the mux floor still adds X-Frame-Options: DENY, which a browser
 * ignores wherever a policy carries frame-ancestors (HTML, "X-Frame-Options").
 */
const EMBEDDED_POLICY = [
  "default-src 'none'",
  "script-src 'nonce-{nonce}'",
  "style-src 'nonce-{nonce}'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "frame-ancestors {embedder}",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const REFUSAL_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

export class EmbeddedDocument implements HttpTarget {
  static create(input: {
    selection: EmbeddedDocumentSelection;
    embedders: readonly string[];
  }): EmbeddedDocument {
    return new EmbeddedDocument(input.selection, new Set(input.embedders));
  }

  private constructor(
    private readonly selection: EmbeddedDocumentSelection,
    private readonly embedders: ReadonlySet<string>,
  ) {}

  fetch = (request: Request): Response => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const embedder = new URL(request.url).searchParams.get("origin") ?? "";
    const common = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
    };
    if (!this.embedders.has(embedder)) {
      return new Response(this.selection.refusal(), {
        status: 403,
        headers: { ...common, "Content-Security-Policy": REFUSAL_POLICY, "X-Frame-Options": "DENY" },
      });
    }

    const nonce = randomBytes(16).toString("base64");

    return new Response(this.selection.document({ nonce, embedder }), {
      status: 200,
      headers: {
        ...common,
        "Content-Security-Policy": EMBEDDED_POLICY.replaceAll("{nonce}", nonce).replace(
          "{embedder}",
          embedder,
        ),
      },
    });
  };
}
