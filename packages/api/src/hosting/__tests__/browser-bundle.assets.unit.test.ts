import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SecurityHeaders } from "../../policy/security-headers.ts";
import { BrowserBundle } from "../browser-bundle.ts";
import { SessionReader } from "../session-reader.ts";

const SHELL = "<html><head></head><body>app</body></html>";
const SCRIPT = "window.booted = true;";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function builtClient(): Promise<BrowserBundle> {
  const dist = await mkdtemp(path.join(tmpdir(), "langwatch-assets-"));
  directories.push(dist);
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), SHELL);
  await writeFile(path.join(dist, "assets/index-abc123.js"), SCRIPT);

  return BrowserBundle.create({
    dist,
    publicConfig: () => "",
    sessionReader: SessionReader.unverified(),
    security: SecurityHeaders.strict(),
  });
}

describe("given a production server with a built client", () => {
  describe("when a client requests an asset that exists", () => {
    /** @scenario "Existing asset is served with the correct MIME type and immutable cache" */
    it("serves the file with its MIME type and an immutable cache", async () => {
      const response = await (
        await builtClient()
      ).fetch(new Request("http://localhost/assets/index-abc123.js"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/javascript");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(await response.text()).toBe(SCRIPT);
    });
  });

  describe("when a client requests an asset that is gone", () => {
    /** @scenario "Missing asset returns a real 404 with no-cache headers" */
    it("answers a 404 that is not the shell and tells caches not to store it", async () => {
      const response = await (
        await builtClient()
      ).fetch(new Request("http://localhost/assets/does-not-exist-xyz.js"));

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("<body>app</body>");
      expect(response.headers.get("cache-control")).toContain("no-store");
    });

    /** @scenario "Missing asset returns 404 even though Accept includes text/html" */
    it("answers a 404 even when the client accepts html", async () => {
      const response = await (
        await builtClient()
      ).fetch(
        new Request("http://localhost/assets/foo-stale.js", {
          headers: { Accept: "text/html,*/*" },
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("<body>app</body>");
    });
  });
});
