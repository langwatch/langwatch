/**
 * @vitest-environment node
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  type CloudflaredModule,
  type CloudflaredScope,
  ensureCloudflaredOnPath,
  resolveCloudflaredFromScopes,
  VoiceTunnelBinaryError,
} from "../voice-cloudflared-binary";

const BIN = "/pkg/cloudflared/bin/cloudflared";
const BIN_DIR = "/pkg/cloudflared/bin";

/** A cloudflared module fake with a spyable installer. */
function fakeModule(
  install: CloudflaredModule["install"] = vi.fn(async () => BIN),
): CloudflaredModule {
  return { bin: BIN, install };
}

/**
 * A fake `require` for one scope: `resolves` says whether it can resolve
 * `cloudflared/package.json`, and loading `cloudflared` returns `mod`.
 */
function fakeScopeRequire(opts: {
  resolves: boolean;
  mod?: Partial<CloudflaredModule>;
}): NodeRequire {
  const req = ((specifier: string): unknown => {
    if (specifier === "cloudflared") return opts.mod;
    throw new Error(`unexpected require(${specifier})`);
  }) as unknown as NodeRequire;
  req.resolve = ((specifier: string): string => {
    if (specifier === "cloudflared/package.json") {
      if (opts.resolves) return "/pkg/cloudflared/package.json";
      throw new Error("Cannot find module 'cloudflared/package.json'");
    }
    throw new Error(`unexpected resolve(${specifier})`);
  }) as NodeRequire["resolve"];
  return req;
}

describe("ensureCloudflaredOnPath", () => {
  describe("given cloudflared is already on PATH", () => {
    describe("when the binary is ensured", () => {
      /** @scenario "cloudflared already on PATH is used as-is" */
      it("short-circuits without resolving or installing anything", async () => {
        const resolveModule = vi.fn(() => fakeModule());
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

        await ensureCloudflaredOnPath({
          isOnPath: () => true,
          resolveModule,
          env,
        });

        expect(resolveModule).not.toHaveBeenCalled();
        expect(env.PATH).toBe("/usr/bin");
      });
    });
  });

  describe("given cloudflared is not on PATH but its binary is present on disk", () => {
    describe("when the binary is ensured", () => {
      /** @scenario "A present cloudflared binary is put on PATH without downloading" */
      it("prepends the binary's directory to PATH and never downloads", async () => {
        const install = vi.fn(async () => BIN);
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

        await ensureCloudflaredOnPath({
          isOnPath: () => false,
          resolveModule: () => fakeModule(install),
          binaryExists: () => true,
          env,
        });

        expect(install).not.toHaveBeenCalled();
        expect(env.PATH).toBe(`${BIN_DIR}:/usr/bin`);
      });
    });
  });

  describe("given cloudflared is not on PATH and its binary is missing", () => {
    describe("when the binary is ensured", () => {
      /** @scenario "A missing cloudflared binary is downloaded then put on PATH" */
      it("downloads the binary, then prepends its directory to PATH", async () => {
        const install = vi.fn(async () => BIN);
        // Missing before install, present after.
        const binaryExists = vi
          .fn<(binPath: string) => boolean>()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

        await ensureCloudflaredOnPath({
          isOnPath: () => false,
          resolveModule: () => fakeModule(install),
          binaryExists,
          env,
        });

        expect(install).toHaveBeenCalledWith(BIN);
        expect(env.PATH).toBe(`${BIN_DIR}:/usr/bin`);
      });
    });

    describe("when the download fails", () => {
      /** @scenario "A cloudflared download failure surfaces as a tunnel binary error" */
      it("throws a tunnel binary error carrying the underlying cause", async () => {
        const install = vi.fn(async () => {
          throw new Error("spawn cloudflared ENOENT");
        });
        const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

        const run = ensureCloudflaredOnPath({
          isOnPath: () => false,
          resolveModule: () => fakeModule(install),
          binaryExists: () => false,
          env,
        });

        await expect(run).rejects.toBeInstanceOf(VoiceTunnelBinaryError);
        await expect(run).rejects.toThrow(/spawn cloudflared ENOENT/);
        // PATH is left untouched on failure.
        expect(env.PATH).toBe("/usr/bin");
      });
    });

    describe("when the download hangs past the timeout", () => {
      /** @scenario "A cloudflared download that hangs is abandoned" */
      it("abandons the download and throws a tunnel binary error", async () => {
        // Never resolves — only the timeout can end it.
        const install = vi.fn(() => new Promise<string>(() => {}));

        await expect(
          ensureCloudflaredOnPath({
            isOnPath: () => false,
            resolveModule: () => fakeModule(install),
            binaryExists: () => false,
            installTimeoutMs: 10,
            env: { PATH: "/usr/bin" },
          }),
        ).rejects.toThrow(/timed out after 10ms/);
      });
    });
  });

  describe("given the cloudflared package cannot be resolved", () => {
    describe("when the langwatch SDK scope resolves it", () => {
      /** @scenario "cloudflared resolves through the langwatch SDK scope first" */
      it("returns the module from the langwatch scope without trying later scopes", () => {
        const langwatchMod = fakeModule();
        const scopes: CloudflaredScope[] = [
          {
            name: "langwatch",
            require: fakeScopeRequire({ resolves: true, mod: langwatchMod }),
          },
          {
            name: "@langwatch/scenario",
            require: fakeScopeRequire({ resolves: true, mod: fakeModule() }),
          },
          {
            name: "app scope",
            require: fakeScopeRequire({ resolves: true, mod: fakeModule() }),
          },
        ];

        const scenarioResolve = vi.spyOn(scopes[1]!.require!, "resolve");

        const mod = resolveCloudflaredFromScopes(scopes);

        expect(mod.bin).toBe(BIN);
        expect(mod.install).toBe(langwatchMod.install);
        expect(scenarioResolve).not.toHaveBeenCalled();
      });
    });

    describe("when the langwatch scope fails but the scenario scope resolves it", () => {
      /** @scenario "cloudflared falls back to the scenario scope when the langwatch scope fails" */
      it("returns the module from the scenario scope", () => {
        const scenarioMod = fakeModule();
        const scopes: CloudflaredScope[] = [
          // Anchor unresolved: this scope is skipped entirely.
          { name: "langwatch", require: null },
          {
            name: "@langwatch/scenario",
            require: fakeScopeRequire({ resolves: true, mod: scenarioMod }),
          },
          { name: "app scope", require: fakeScopeRequire({ resolves: false }) },
        ];

        const mod = resolveCloudflaredFromScopes(scopes);

        expect(mod.install).toBe(scenarioMod.install);
      });
    });

    describe("when no scope can resolve it", () => {
      /** @scenario "cloudflared unresolvable from every scope names all tried scopes" */
      it("throws naming all three tried scopes", () => {
        const scopes: CloudflaredScope[] = [
          { name: "langwatch", require: null },
          {
            name: "@langwatch/scenario",
            require: fakeScopeRequire({ resolves: false }),
          },
          { name: "app scope", require: fakeScopeRequire({ resolves: false }) },
        ];

        expect(() => resolveCloudflaredFromScopes(scopes)).toThrow(
          /could not resolve the cloudflared package from any of: langwatch, @langwatch\/scenario, app scope/,
        );
      });
    });

    describe("when the binary is ensured", () => {
      /** @scenario "An unresolvable cloudflared package surfaces as a tunnel binary error" */
      it("throws a tunnel binary error naming the resolution failure", async () => {
        const resolveModule = vi.fn(() => {
          throw new Error("Cannot find module 'cloudflared'");
        });

        await expect(
          ensureCloudflaredOnPath({
            isOnPath: () => false,
            resolveModule,
            env: { PATH: "/usr/bin" },
          }),
        ).rejects.toThrow(/could not resolve the cloudflared package/);
      });
    });
  });
});
