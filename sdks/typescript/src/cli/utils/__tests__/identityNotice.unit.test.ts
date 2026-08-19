/**
 * The identity notice's contract: exact one-line wording per mode, stderr
 * only, TTY-gated colour, and the 30-minute per-(credential, mode)
 * suppression window backed by notice-state.json next to config.json.
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  maybePrintIdentityNotice,
  NOTICE_SUPPRESSION_MS,
  noticeStatePath,
  rememberProjectName,
} from "../identityNotice";

const DEVICE_LINE =
  "Using your personal project (device login). Read another project: langwatch login --project";

describe("maybePrintIdentityNotice()", () => {
  let dir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedConfigEnv: string | undefined;
  let savedChalkLevel: number;
  let savedIsTTY: boolean | undefined;

  const stderrLines = () =>
    errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));

  const okFetch = (name: string): typeof fetch =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: "p1", name, slug: "s", isPersonal: false }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-notice-"));
    savedConfigEnv = process.env.LANGWATCH_CLI_CONFIG;
    process.env.LANGWATCH_CLI_CONFIG = path.join(dir, "config.json");
    savedChalkLevel = chalk.level;
    savedIsTTY = process.stderr.isTTY;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (savedConfigEnv === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
    else process.env.LANGWATCH_CLI_CONFIG = savedConfigEnv;
    chalk.level = savedChalkLevel as typeof chalk.level;
    Object.defineProperty(process.stderr, "isTTY", {
      value: savedIsTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const setStderrTTY = (value: boolean) => {
    Object.defineProperty(process.stderr, "isTTY", {
      value,
      configurable: true,
    });
  };

  /** @scenario device mode prints a one-line identity notice on stderr */
  it("prints the exact device-mode line, once, on stderr", async () => {
    setStderrTTY(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await maybePrintIdentityNotice({
      mode: "device",
      apiKey: "pkey_a",
      endpoint: "https://app.langwatch.ai",
    });

    expect(stderrLines()).toEqual([DEVICE_LINE]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  /** @scenario api-key mode names the project the key belongs to */
  it("prints the api-key line with the project's name", async () => {
    setStderrTTY(false);

    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-b",
      endpoint: "https://app.langwatch.ai",
      fetchImpl: okFetch("Checkout Bot"),
    });

    expect(stderrLines()).toEqual([
      'Using API key for project "Checkout Bot". Switch: langwatch login --project | --device',
    ]);
  });

  /** @scenario the project name is fetched once and cached */
  it("fetches the project name once and reads the cache afterwards", async () => {
    setStderrTTY(false);
    const fetchImpl = okFetch("Checkout Bot");

    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-c",
      endpoint: "https://app.langwatch.ai",
      fetchImpl,
    });
    // Wipe suppression, keep the name cache, so the second call prints again.
    const state = JSON.parse(fs.readFileSync(noticeStatePath(), "utf8"));
    delete state.shownAt;
    fs.writeFileSync(noticeStatePath(), JSON.stringify(state));

    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-c",
      endpoint: "https://app.langwatch.ai",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stderrLines()).toHaveLength(2);
    expect(stderrLines()[1]).toContain('"Checkout Bot"');
  });

  it("degrades to a nameless api-key line when the lookup fails", async () => {
    setStderrTTY(false);
    const failingFetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-d",
      endpoint: "https://app.langwatch.ai",
      fetchImpl: failingFetch,
    });

    expect(stderrLines()).toEqual([
      "Using API key from LANGWATCH_API_KEY. Switch: langwatch login --project | --device",
    ]);
  });

  it("uses a login-seeded project name without any fetch", async () => {
    setStderrTTY(false);
    rememberProjectName("sk-e", "Seeded Project");
    const fetchImpl = okFetch("Wrong Name");

    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-e",
      endpoint: "https://app.langwatch.ai",
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderrLines()[0]).toContain('"Seeded Project"');
  });

  /** @scenario the notice is yellow only when stderr is a TTY */
  it("colours the line only when stderr is a TTY", async () => {
    chalk.level = 3;
    setStderrTTY(true);
    await maybePrintIdentityNotice({
      mode: "device",
      apiKey: "pkey_tty",
      endpoint: "https://app.langwatch.ai",
    });
    expect(stderrLines()[0]).toContain("[");

    setStderrTTY(false);
    await maybePrintIdentityNotice({
      mode: "device",
      apiKey: "pkey_no_tty",
      endpoint: "https://app.langwatch.ai",
    });
    expect(stderrLines()[1]).toBe(DEVICE_LINE);
    expect(stderrLines()[1]).not.toContain("[");
  });

  /** @scenario the notice is suppressed for 30 minutes per credential and mode */
  it("suppresses repeats within the window and reprints after it", async () => {
    setStderrTTY(false);
    const args = {
      mode: "device" as const,
      apiKey: "pkey_f",
      endpoint: "https://app.langwatch.ai",
    };

    await maybePrintIdentityNotice(args);
    await maybePrintIdentityNotice(args);
    expect(stderrLines()).toHaveLength(1);

    // Age the recorded showing past the window.
    const state = JSON.parse(fs.readFileSync(noticeStatePath(), "utf8"));
    for (const key of Object.keys(state.shownAt)) {
      state.shownAt[key] = Date.now() - NOTICE_SUPPRESSION_MS - 1;
    }
    fs.writeFileSync(noticeStatePath(), JSON.stringify(state));

    await maybePrintIdentityNotice(args);
    expect(stderrLines()).toHaveLength(2);
  });

  /** @scenario switching modes re-triggers the notice despite suppression */
  it("keys suppression on the (credential, mode) pair", async () => {
    setStderrTTY(false);

    await maybePrintIdentityNotice({
      mode: "device",
      apiKey: "pkey_g",
      endpoint: "https://app.langwatch.ai",
    });
    await maybePrintIdentityNotice({
      mode: "api-key",
      apiKey: "sk-other",
      endpoint: "https://app.langwatch.ai",
      fetchImpl: okFetch("Other Project"),
    });

    expect(stderrLines()).toHaveLength(2);
  });

  it("stores only credential hashes, never the credential", async () => {
    setStderrTTY(false);
    await maybePrintIdentityNotice({
      mode: "device",
      apiKey: "pkey_super_secret",
      endpoint: "https://app.langwatch.ai",
    });

    const raw = fs.readFileSync(noticeStatePath(), "utf8");
    expect(raw).not.toContain("pkey_super_secret");
  });

  it("never throws, even with an unwritable state directory", async () => {
    setStderrTTY(false);
    process.env.LANGWATCH_CLI_CONFIG = "/dev/null/nope/config.json";

    await expect(
      maybePrintIdentityNotice({
        mode: "device",
        apiKey: "pkey_h",
        endpoint: "https://app.langwatch.ai",
      }),
    ).resolves.toBeUndefined();
  });
});
