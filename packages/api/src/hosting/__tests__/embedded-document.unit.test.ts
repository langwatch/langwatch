import { describe, expect, it } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { EmbeddedDocument } from "../framed-document.ts";
import { HttpMux } from "../http-mux.ts";

const DOCS = "https://langwatch.ai";
const selection = {
  path: "/connect/docs/frame",
  document: ({ nonce, embedder }: { nonce: string; embedder: string }) =>
    `<script nonce="${nonce}">/* ${embedder} */</script>`,
  refusal: () => "<p>refused</p>",
};
const served = (origin: string, method = "GET") =>
  HttpMux.create()
    .use(SecurityHeaders.strict())
    .route(selection.path, EmbeddedDocument.create({ selection, embedders: [DOCS] }))
    .fetch(
      new Request(`https://app.langwatch.ai${selection.path}?origin=${encodeURIComponent(origin)}`, {
        method,
      }),
    );

describe("an embedded document", () => {
  describe("when a registered docs origin asks for it", () => {
    /** @scenario "Only a registered docs origin may frame the session frame" */
    it("lets that origin alone embed it, running only its own script against its own origin", async () => {
      const response = await served(DOCS);
      const policy = response.headers.get("Content-Security-Policy") ?? "";
      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];

      expect(response.status).toBe(200);
      expect(policy).toContain(`frame-ancestors ${DOCS};`);
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("connect-src 'self'");
      expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|sandbox/);
      expect(await response.text()).toBe(`<script nonce="${nonce}">/* ${DOCS} */</script>`);
      expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    /** @scenario "Only a registered docs origin may frame the session frame" */
    it("answers a fresh nonce every time", async () => {
      const first = (await served(DOCS)).headers.get("Content-Security-Policy");
      const second = (await served(DOCS)).headers.get("Content-Security-Policy");

      expect(first).not.toBe(second);
    });
  });

  describe("when any other origin asks for it", () => {
    /** @scenario "Only a registered docs origin may frame the session frame" */
    it.each([
      ["an unregistered origin", "https://evil.example"],
      ["a lookalike of a registered one", "https://langwatch.ai.evil.example"],
      ["a registered origin with a path", `${DOCS}/docs`],
      ["no origin at all", ""],
    ])("refuses %s with a page nothing may embed", async (_label, origin) => {
      const response = await served(origin);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("<p>refused</p>");
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("answers only GET and HEAD", async () => {
      expect((await served(DOCS, "POST")).status).toBe(405);
    });
  });
});
