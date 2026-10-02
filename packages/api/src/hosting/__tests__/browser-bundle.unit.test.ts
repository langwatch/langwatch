import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { BrowserBundle } from "../browser-bundle.ts";
import { HttpMux } from "../http-mux.ts";
import { SessionReader } from "../session-reader.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dist = await mkdtemp(path.join(tmpdir(), "langwatch-bundle-"));
  directories.push(dist);
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), "<html><head></head><body>app</body></html>");
  await writeFile(path.join(dist, "assets/app.js"), "window.booted = true;");

  return dist;
}

describe("given a browser bundle sharing API sessions", () => {
  /** @scenario "Bundle documents share sessions while assets skip verification" */
  it("reads the session once for documents, injects config, and skips sessions for assets", async () => {
    const verify = vi.fn(async () => ({ userId: "person" }));
    const publicConfig = vi.fn(() => '<meta name="public-config" content="safe">');

    const bundle = BrowserBundle.create({
      dist: await fixture(),
      publicConfig,
      sessionReader: SessionReader.create({ verify }),
      security: SecurityHeaders.strict(),
    });

    const mux = HttpMux.create().route("/", bundle);
    const document = await mux.fetch(new Request("http://localhost/projects/one"));
    expect(await document.text()).toContain('<head><meta name="public-config"');
    expect(publicConfig).toHaveBeenCalledWith({ userId: "person" });
    expect(verify).toHaveBeenCalledTimes(1);
    const asset = await mux.fetch(new Request("http://localhost/assets/app.js"));
    expect(await asset.text()).toBe("window.booted = true;");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await mux.fetch(new Request("http://localhost/assets/gone.js"))).status).toBe(404);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  describe("when the deployment's public settings change between two page loads", () => {
    /**
     * The settings carry the sign-in providers the Connect offers are drawn
     * from, so a document kept past a restart would offer a removed provider.
     */
    /** @scenario A provider the deployment stopped offering leaves the Connect offers on reload */
    it("projects them again for every document and asks the browser to revalidate it", async () => {
      let offered = "microsoft";
      const bundle = BrowserBundle.create({
        dist: await fixture(),
        publicConfig: () => `<meta name="public-config" content="${offered}">`,
        sessionReader: SessionReader.create({ verify: async () => ({ userId: "person" }) }),
        security: SecurityHeaders.strict(),
      });
      const mux = HttpMux.create().route("/", bundle);

      const first = await mux.fetch(new Request("http://localhost/settings/authentication"));
      offered = "none";
      const second = await mux.fetch(new Request("http://localhost/settings/authentication"));

      expect(await first.text()).toContain('content="microsoft"');
      expect(await second.text()).toContain('content="none"');
      expect(second.headers.get("cache-control")).toBe("no-cache");
    });
  });

  /** @scenario "A document access policy can redirect before rendering" */
  it("enforces a document policy before projecting config while leaving assets available", async () => {
    const project = vi.fn(() => "must not render");

    const bundle = BrowserBundle.create({
      dist: await fixture(),
      publicConfig: project,
      sessionReader: SessionReader.unverified(),
      security: SecurityHeaders.strict(),
      authorizeDocument: (_request, caller) => {
        if (!caller) return Response.redirect("http://localhost/sign-in", 302);
      },
    });

    const mux = HttpMux.create().use(SecurityHeaders.strict()).route("/", bundle);
    const response = await mux.fetch(new Request("http://localhost/private"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/sign-in");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(project).not.toHaveBeenCalled();
    expect((await mux.fetch(new Request("http://localhost/assets/app.js"))).status).toBe(200);
  });
});

describe("the browser application on the door", () => {
  function bundleOver(dist: string | undefined, security = SecurityHeaders.strict()) {
    return BrowserBundle.create({
      dist,
      publicConfig: () => '<meta name="public-config">',
      sessionReader: SessionReader.unverified(),
      security,
    });
  }

  /** @scenario "The browser application answers an unclaimed address" */
  it("serves the shell at an address no transport claimed, for the single page application to route", async () => {
    const response = await bundleOver(await fixture()).fetch(
      new Request("http://localhost/projects/one/settings"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toContain("<body>app</body>");
  });

  /** @scenario "A built asset is missing" */
  it("answers 404 for a content-hashed asset that is gone, never the shell", async () => {
    const response = await bundleOver(await fixture()).fetch(
      new Request("http://localhost/assets/gone.js"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<body>");
  });

  /** @scenario "A built asset is served" */
  it("serves a content-hashed asset with an immutable cache", async () => {
    const response = await bundleOver(await fixture()).fetch(
      new Request("http://localhost/assets/app.js"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("window.booted = true;");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  /** @scenario "A write is never answered by the browser application" */
  it("declines a write at an unclaimed address instead of answering it with the shell", async () => {
    const response = await bundleOver(await fixture()).fetch(
      new Request("http://localhost/projects/one", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(405);
    expect(await response.text()).not.toContain("<body>");
  });

  /** @scenario "The deployment carries no browser build" */
  it("answers 404 to a page request when no build is present", async () => {
    const bundle = bundleOver(void 0);

    expect(bundle.serves).toBe(false);
    expect((await bundle.fetch(new Request("http://localhost/projects/one"))).status).toBe(404);
  });

  /** @scenario "The served page carries this deployment's configuration" */
  it("injects the public configuration at the start of the head, before the bundle's scripts", async () => {
    const dist = await fixture();
    await writeFile(
      path.join(dist, "index.html"),
      '<html><head><script src="/assets/app.js"></script></head><body>app</body></html>',
    );

    const html = await (await bundleOver(dist).fetch(new Request("http://localhost/"))).text();

    expect(html.indexOf('<meta name="public-config">')).toBeGreaterThan(-1);
    expect(html.indexOf('<meta name="public-config">')).toBeLessThan(
      html.indexOf('<script src="/assets/app.js">'),
    );
    expect(html).toContain('<head><meta name="public-config">');
  });

  /** @scenario "The served page carries this deployment's security headers" */
  it("sends the deployment's own security headers with the document", async () => {
    const security = SecurityHeaders.strict().with("Permissions-Policy", "camera=()");

    const response = await bundleOver(await fixture(), security).fetch(
      new Request("http://localhost/"),
    );

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("permissions-policy")).toBe("camera=()");
  });
});
