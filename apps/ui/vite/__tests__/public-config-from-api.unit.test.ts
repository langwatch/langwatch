import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createPublicAppConfigMetaTag,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { fetchPublicConfigFromApi, fetchShellOf, isLocalHost } from "../public-config-from-api";

const config: PublicAppConfig = {
  process: { mode: "development", deployment: "self-hosted", nlp: false },
};
const answering = (body: string) => async () => new Response(body, { status: 200 });

async function selfSigned(): Promise<{ key: Buffer; cert: Buffer }> {
  const directory = mkdtempSync(path.join(tmpdir(), "dev-cert-"));
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1"].concat([
      "-subj",
      "/CN=localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ]),
    { stdio: "ignore" },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

describe("given the dev server needs the api's public config", () => {
  /** @scenario "The dev server injects the api's public config" */
  it("lifts the api shell's meta tag unchanged", async () => {
    const html = `<html><head>${createPublicAppConfigMetaTag(config)}</head></html>`;

    await expect(
      fetchPublicConfigFromApi({ apiUrl: "http://api.test", fetchShell: answering(html) }),
    ).resolves.toEqual(config);
  });

  /** @scenario "The development server carries the api's public URL unchanged" */
  it("keeps the auth slice's public URL as the api rendered it", async () => {
    const withAuth: PublicAppConfig = { ...config, auth: { publicUrl: "http://localhost:5580" } };
    const html = `<html><head>${createPublicAppConfigMetaTag(withAuth)}</head></html>`;

    const lifted = await fetchPublicConfigFromApi({
      apiUrl: "http://api.test",
      fetchShell: answering(html),
    });

    expect(lifted.auth?.publicUrl).toBe("http://localhost:5580");
  });

  /** @scenario "The api is unreachable when the dev server starts" */
  it("fails naming the api address once the wait lapses", async () => {
    const refused = async (): Promise<Response> => {
      throw new Error("connect ECONNREFUSED");
    };

    await expect(
      fetchPublicConfigFromApi({ apiUrl: "http://api.test:6560", waitMs: 0, fetchShell: refused }),
    ).rejects.toThrow(/http:\/\/api\.test:6560\/index\.html did not answer.*ECONNREFUSED/);
  });

  /** @scenario "The api answers a shell without the config meta tag" */
  it("fails naming the api address and the missing meta tag", async () => {
    await expect(
      fetchPublicConfigFromApi({
        apiUrl: "http://api.test:6560",
        waitMs: 0,
        fetchShell: answering("<html><head></head></html>"),
      }),
    ).rejects.toThrow(/http:\/\/api\.test:6560.*langwatch-public-config/);
  });

  /** @scenario "A local https api with a self-signed certificate is trusted" */
  it("trusts a self-signed api on a local host only", async () => {
    const { key, cert } = await selfSigned();
    const server = createServer({ key, cert }, (_request, response) =>
      response.end(`<head>${createPublicAppConfigMetaTag(config)}</head>`),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const shell = await fetchShellOf(`https://localhost:${port}/index.html`);
      expect(await shell.text()).toContain("langwatch-public-config");
      expect(["localhost", "127.0.0.1", "app.x.localhost"].every(isLocalHost)).toBe(true);
      expect(isLocalHost("api.example.com")).toBe(false);
    } finally {
      server.close();
    }
  });
});
