/**
 * What `langwatch ingest install` says about the key: minted or reused.
 * Feature: specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";

const { mintIngestionKeyMock, listIngestionKeysMock } = vi.hoisted(() => ({
  mintIngestionKeyMock: vi.fn(),
  listIngestionKeysMock: vi.fn(),
}));

vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>("@/cli/utils/governance/cli-api");
  return {
    ...actual,
    mintIngestionKey: mintIngestionKeyMock,
    listIngestionKeys: listIngestionKeysMock,
  };
});

const CACHED_SECRET = "ik-lw-cached000000000000_secret";
const MINTED_SECRET = "ik-lw-fresh0000000000000_secret";

let tmpDir: string;
let configFile: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

const writeConfig = (extra: Record<string, unknown> = {}): void => {
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      access_token: "tok",
      control_plane_url: "http://app.example.com",
      gateway_url: "http://gateway.example.com",
      organization: { id: "o1", slug: "acme" },
      ...extra,
    }),
  );
};

const install = async ({ json = false }: { json?: boolean } = {}): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("claude_code", { envOnly: true, json });
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-key-"));
  configFile = path.join(tmpDir, "config.json");
  process.env.LANGWATCH_CLI_CONFIG = configFile;
  mintIngestionKeyMock.mockResolvedValue({
    token: MINTED_SECRET,
    prefix: "ik-lw-fresh0000000000000",
    endpoint: "http://app.example.com/api/otel",
  });
  listIngestionKeysMock.mockResolvedValue([
    { sourceType: "claude_code", lookupId: "cached000000000000" },
  ]);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the ingestion install's key report", () => {
  describe("given no cached ingestion key", () => {
    beforeEach(() => writeConfig());

    /** @scenario "The install says it minted a key only when it minted one" */
    it("says it minted a new key and records it as minted", async () => {
      await install();
      expect(stdout()).toContain("Minted a new ingestion key for");
      expect(mintIngestionKeyMock).toHaveBeenCalledTimes(1);

      stdoutSpy.mockClear();
      writeConfig();
      await install({ json: true });
      expect(JSON.parse(stdout())).toMatchObject({ key_action: "minted" });
    });
  });

  describe("given a live cached ingestion key", () => {
    beforeEach(() =>
      writeConfig({
        default_personal_ingest_keys: {
          claude_code: { secret: CACHED_SECRET, prefix: "ik-lw-cached000000000000" },
        },
      }),
    );

    /** @scenario "The install says it reused the key it already had" */
    it("says it reused the existing key and never that it minted one", async () => {
      await install();

      expect(stdout()).toContain("Reused the existing ingestion key for");
      expect(stdout()).not.toMatch(/minted/i);
      expect(mintIngestionKeyMock).not.toHaveBeenCalled();

      stdoutSpy.mockClear();
      await install({ json: true });
      expect(JSON.parse(stdout())).toMatchObject({ key_action: "reused" });
    });
  });
});
