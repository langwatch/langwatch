import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { SessionReader } from "../../rest/credential.ts";
import { BrowserBundle } from "../browser-bundle.ts";
import { HttpMux } from "../http-mux.ts";

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
