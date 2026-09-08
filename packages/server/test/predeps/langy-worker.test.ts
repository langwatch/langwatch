import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aigatewayAssetName } from "../../src/predeps/aigateway.ts";
import {
  langyWorkerAssetName,
  makeLangyWorkerPredep,
} from "../../src/predeps/langy-worker.ts";
import { paths } from "../../src/shared/paths.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function temporaryPaths() {
  const root = await mkdtemp(join(tmpdir(), "langy-worker-predep-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  return { ...paths, root, bin };
}

describe("langy-worker predep", () => {
  it("maps every release target to the asset name published by CI", () => {
    expect(langyWorkerAssetName("linux-x64")).toBe("langy-worker-linux-x64");
    expect(langyWorkerAssetName("linux-arm64")).toBe("langy-worker-linux-arm64");
    expect(langyWorkerAssetName("linux-x64-musl")).toBe("langy-worker-linux-x64-musl");
    expect(langyWorkerAssetName("linux-arm64-musl")).toBe(
      "langy-worker-linux-arm64-musl",
    );
    expect(langyWorkerAssetName("darwin-x64")).toBe("langy-worker-darwin-x64");
    expect(langyWorkerAssetName("darwin-arm64")).toBe("langy-worker-darwin-arm64");
  });

  it("reuses the static Linux gateway artifacts on musl hosts", () => {
    expect(aigatewayAssetName("linux-x64-musl")).toBe("aigateway-linux-amd64");
    expect(aigatewayAssetName("linux-arm64-musl")).toBe("aigateway-linux-arm64");
  });

  it("is satisfied without a binary when Langy is disabled", async () => {
    const predep = makeLangyWorkerPredep({
      isEnabled: false,
      serverVersion: "3.2.1",
    });

    await expect(predep.detect(await temporaryPaths())).resolves.toEqual({
      installed: true,
      version: "skipped",
      resolvedPath: "",
    });
  });

  it("redownloads a valid worker that belongs to an older server release", async () => {
    const testPaths = await temporaryPaths();
    const binary = join(testPaths.bin, "langy-worker");
    writeFileSync(binary, "#!/bin/sh\necho 0.1.0\n");
    chmodSync(binary, 0o755);
    writeFileSync(join(testPaths.bin, ".langy-worker-server-version"), "3.2.0\n");
    const predep = makeLangyWorkerPredep({
      isEnabled: true,
      serverVersion: "3.2.1",
    });

    await expect(predep.detect(testPaths)).resolves.toEqual({
      installed: false,
      reason: "langy-worker belongs to server v3.2.0, this release wants v3.2.1",
    });
  });

  it("downloads the matching release asset and records its server version", async () => {
    const testPaths = await temporaryPaths();
    const fetchMock = vi.fn(async () => {
      return new Response("#!/bin/sh\necho 0.1.0\n", {
        status: 200,
        headers: { "content-length": "25" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const predep = makeLangyWorkerPredep({
      isEnabled: true,
      serverVersion: "3.2.1",
    });

    const result = await predep.install({
      platform: "linux-x64",
      paths: testPaths,
      task: { output: void 0 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/langwatch/langwatch/releases/download/v3.2.1/langy-worker-linux-x64",
    );
    expect(result).toEqual({
      version: "0.1.0",
      resolvedPath: join(testPaths.bin, "langy-worker"),
    });
    expect(readFileSync(join(testPaths.bin, ".langy-worker-server-version"), "utf8")).toBe(
      "3.2.1\n",
    );
    await expect(predep.detect(testPaths)).resolves.toEqual({
      installed: true,
      version: "0.1.0",
      resolvedPath: join(testPaths.bin, "langy-worker"),
    });
  });

  it("explains how a checkout can recover when its release asset does not exist", async () => {
    const testPaths = await temporaryPaths();
    vi.stubEnv("LANGWATCH_LANGY_WORKER_DEV_BUILD", "");
    vi.stubEnv("LANGWATCH_AIGATEWAY_DEV_BUILD", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const predep = makeLangyWorkerPredep({
      isEnabled: true,
      serverVersion: "0.0.0-dev",
    });

    await expect(
      predep.install({
        platform: "linux-x64",
        paths: testPaths,
        task: { output: void 0 },
      }),
    ).rejects.toThrow("LANGWATCH_LANGY_WORKER_DEV_BUILD=1");
  });
});
