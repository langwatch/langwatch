import { describe, expect, it } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { FramedDocument } from "../framed-document.ts";
import { HttpMux } from "../http-mux.ts";

const document = ({ nonce }: { nonce: string }) => `<script nonce="${nonce}"></script>`;

describe("a framed document", () => {
  /** @scenario "The frame document is served on its own route with its own policy" */
  it("stamps one fresh nonce into both the body and the script policy", async () => {
    const target = FramedDocument.create({ path: "/sandbox/frame", document });

    const first = target.fetch(new Request("http://localhost/sandbox/frame"));
    const second = target.fetch(new Request("http://localhost/sandbox/frame"));
    const policy = first.headers.get("Content-Security-Policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];

    expect(first.status).toBe(200);
    expect(nonce).toBeTruthy();
    expect(await first.text()).toContain(`nonce="${nonce}"`);
    expect(policy).toContain("frame-ancestors 'self'");
    expect(second.headers.get("Content-Security-Policy")).not.toBe(policy);
  });

  /** @scenario "The app's own policy is unchanged by the sandbox" */
  it("keeps its own frame headers under the mux's strict floor", async () => {
    const mux = HttpMux.create()
      .use(SecurityHeaders.strict())
      .route("/sandbox/frame", FramedDocument.create({ path: "/sandbox/frame", document }))
      .route("/", () => new Response("app"));

    const framed = await mux.fetch(new Request("http://localhost/sandbox/frame"));
    const app = await mux.fetch(new Request("http://localhost/"));

    expect(framed.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(framed.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(app.headers.get("X-Frame-Options")).toBe("DENY");
  });

  /** @scenario "The frame document is sandboxed even when opened directly" */
  it("carries the sandbox directive so a direct open runs at an opaque origin", () => {
    const target = FramedDocument.create({ path: "/sandbox/frame", document });

    const policy = target
      .fetch(new Request("http://localhost/sandbox/frame"))
      .headers.get("Content-Security-Policy");

    expect(policy).toContain("sandbox allow-scripts");
  });

  /** @scenario "The frame document is served on its own route with its own policy" */
  it("lets packages load from any https origin while inline script needs the nonce", () => {
    const policy =
      FramedDocument.create({ path: "/sandbox/frame", document })
        .fetch(new Request("http://localhost/sandbox/frame"))
        .headers.get("Content-Security-Policy") ?? "";
    const directive = (name: string) =>
      policy.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";

    expect(directive("script-src")).toMatch(/https: blob: data:/);
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    for (const name of ["style-src", "font-src", "img-src", "connect-src"]) {
      expect(directive(name)).toContain("https:");
    }
  });

  /** @scenario "The frame's own inline scripts survive a nonce added upstream" */
  it("mints a base64 nonce of at least 16 bytes per answer", () => {
    const target = FramedDocument.create({ path: "/sandbox/frame", document });
    const nonceOf = () =>
      /'nonce-([^']+)'/.exec(
        target
          .fetch(new Request("http://localhost/sandbox/frame"))
          .headers.get("Content-Security-Policy") ?? "",
      )?.[1] ?? "";

    const nonce = nonceOf();

    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(nonce, "base64").length).toBeGreaterThanOrEqual(16);
    expect(nonceOf()).not.toBe(nonce);
  });

  it("answers anything but a read with 405", () => {
    const target = FramedDocument.create({ path: "/sandbox/frame", document });

    const refused = target.fetch(new Request("http://localhost/sandbox/frame", { method: "POST" }));

    expect(refused.status).toBe(405);
    expect(refused.headers.get("Allow")).toBe("GET, HEAD");
  });
});
