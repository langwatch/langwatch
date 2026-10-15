/**
 * @vitest-environment node
 * The application root as a production client receives it, through the real bundle and mux.
 * Spec: specs/security/mcp-documentation-fetch-hardening.feature
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { browserBundleDefaults } from "../../policy/defaults.ts";
import { BrowserBundle } from "../browser-bundle.ts";
import { HttpMux } from "../http-mux.ts";
import { SessionReader } from "../session-reader.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function applicationRoot({ production }: { production: boolean }): Promise<Response> {
  const dist = await mkdtemp(path.join(tmpdir(), "langwatch-root-"));
  directories.push(dist);
  await writeFile(path.join(dist, "index.html"), "<html><head></head><body>app</body></html>");
  const bundle = BrowserBundle.create({
    dist,
    publicConfig: () => '<meta name="public-config">',
    sessionReader: SessionReader.unverified(),
    security: browserBundleDefaults({ production }),
  });

  return HttpMux.create().route("/", bundle).fetch(new Request("http://localhost/"));
}

describe("the application root in production", () => {
  describe("when a client requests it", () => {
    /** @scenario "Production HTTP responses include the Permissions-Policy header" */
    it("carries a Permissions-Policy that disables every unused capability", async () => {
      const response = await applicationRoot({ production: true });
      const directives = (response.headers.get("permissions-policy") ?? "").split(", ");

      expect(response.status).toBe(200);
      expect(directives).toEqual(
        expect.arrayContaining([
          "geolocation=()",
          "microphone=(self)",
          "camera=()",
          "payment=()",
          "usb=()",
        ]),
      );
    });
  });
});
