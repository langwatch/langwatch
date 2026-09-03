import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const packageEntry = fileURLToPath(new URL("../index.ts", import.meta.url));

describe("runtime safety", () => {
  it("creates and uses the logger in a browser-targeted bundle", async () => {
    const result = await build({
      entryPoints: [packageEntry],
      bundle: true,
      define: { process: "undefined" },
      format: "esm",
      metafile: true,
      platform: "browser",
      write: false,
    });

    const bundledInputs = Object.keys(result.metafile.inputs);
    expect(
      bundledInputs.some((input) =>
        /@opentelemetry|node:async_hooks|superjson/.test(input),
      ),
    ).toBe(false);

    const bundle = result.outputFiles[0];
    expect(bundle).toBeDefined();

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(
      bundle!.contents,
    ).toString("base64")}`;
    const telemetry = (await import(moduleUrl)) as typeof import("../index");

    expect(() => {
      const logger = telemetry.createLogger("browser-runtime-smoke");
      expect(logger.level).toBe("info");
      logger.info({ runtime: "browser" }, "browser logger is operational");
      logger.error(
        { error: new Error("browser error") },
        "browser error serialization is operational",
      );

      telemetry.configureLogger({ environment: "production" });
      expect(telemetry.createLogger("browser-configured-runtime-smoke").level).toBe("info");
    }).not.toThrow();
  });

  it("creates and uses the logger with context in a real Node process", async () => {
    const tempDirectory = await mkdtemp(`${packageRoot}/.runtime-safety-`);
    const outputFile = `${tempDirectory}/node-runtime-smoke.mjs`;

    try {
      await build({
        bundle: true,
        format: "esm",
        outfile: outputFile,
        packages: "external",
        platform: "node",
        stdin: {
          contents: `
            import { configureLogger, createLogger } from "./src/index.ts";
            import { runWithContext } from "./src/context/index.ts";

            configureLogger({ environment: "test", level: "error" });
            const logger = createLogger("node-runtime-smoke");
            runWithContext({ organizationId: "runtime-org" }, () => {
              logger.error(
                { error: new Error("node error"), runtime: "node" },
                "node logger is operational",
              );
            });
            process.stdout.write("NODE_RUNTIME_SMOKE_OK\\n");
          `,
          resolveDir: packageRoot,
          sourcefile: "node-runtime-smoke.ts",
        },
      });

      const { stdout } = await execFileAsync(process.execPath, [outputFile], {
        timeout: 10_000,
      });

      expect(stdout).toContain("NODE_RUNTIME_SMOKE_OK");
      expect(stdout).toContain("node logger is operational");
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});
