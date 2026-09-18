import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PINNED_VEGA_PACKAGES: Readonly<Record<string, string>> = {
  vega: "6.3.1",
  "vega-lite": "6.4.3",
  "vega-embed": "7.1.0",
};

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  version: z.string().optional(),
});

const readManifest = (path: string) => manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));

describe("the analytics web Vega dependency set", () => {
  it("declares the reviewed runtime versions directly and exactly", () => {
    const manifest = readManifest(join(PACKAGE_ROOT, "package.json"));
    for (const [name, version] of Object.entries(PINNED_VEGA_PACKAGES)) {
      expect(manifest.dependencies?.[name], `${name} must be direct`).toBe(version);
      expect(/^[~^><=*]|\s|x/.test(version), `${name} must be exact-pinned`).toBe(false);
    }
  });

  it("keeps Vega-Lite on Vega 6 and Vega Embed 7", () => {
    const installed = (name: string) =>
      readManifest(join(PACKAGE_ROOT, "node_modules", name, "package.json"));
    expect(installed("vega-lite").peerDependencies?.vega).toBe("^6.0.0");
    expect(installed("vega").version).toMatch(/^6\./);
    expect(installed("vega-embed").version).toMatch(/^7\./);
  });
});
