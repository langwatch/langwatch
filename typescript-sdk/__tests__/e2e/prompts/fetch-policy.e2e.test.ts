import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  runAlwaysFetchPolicy,
  runCacheTtlPolicy,
  runDefaultFetchPolicy,
  runMaterializedOnlyPolicy,
} from "../../../examples/prompt-management/fetch-policy";
import { HandleUtil } from "./helpers/handle.util";
import { TempDirUtil } from "./helpers/temp-dir.util";
import { type LangWatch } from "../../../dist";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import { CliRunner } from "../cli/helpers/cli-runner";

/**
 * NOTE: This test leaves prompts in the test DB
 * Since the test DB is ephemeral, this is not a problem
 * and not work the overhead of code/CI time to clean up,
 * but it is something to be aware of.
 */

describe("Prompt fetch policies (real API)", () => {
  let langwatch: LangWatch;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.resetModules();
  });

  const withFetchSpy = async <T>(fn: () => Promise<T>) => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (...args) => {
      calls += 1;
      // @ts-ignore
      return originalFetch(...args);
    };
    try {
      const result = await fn();
      return { result, calls };
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  it("default (materialized-first) returns created prompt via API", async () => {
    const handle = HandleUtil.unique("default-policy");
    await langwatch.prompts.create({
      handle,
      prompt: "Hello from default policy",
    });

    const { result: prompt, calls } = await withFetchSpy(() =>
      runDefaultFetchPolicy(handle),
    );
    expect(prompt).toBeTruthy();
    expect(prompt?.handle).toContain("default-policy");
    expect((prompt)?.prompt ?? "").toContain(
      "Hello from default policy",
    );
    expect(calls).toBeGreaterThan(0);
    await langwatch.prompts.delete(handle);
  }, 60_000);

  it("always fetch (API first) returns server prompt and hits API", async () => {
    const handle = HandleUtil.unique("always-fetch");
    await langwatch.prompts.create({ handle, prompt: "Always fetch from API" });

    const { result: prompt, calls } = await withFetchSpy(() =>
      runAlwaysFetchPolicy(handle),
    );
    expect(prompt).toBeTruthy();
    expect(prompt?.handle).toContain("always-fetch");
    expect((prompt)?.prompt ?? "").toContain("Always fetch from API");
    expect(calls).toBeGreaterThan(0);
    await langwatch.prompts.delete(handle);
  }, 60_000);

  it("materialized only (local file) returns local prompt without hitting API", async () => {
    const handle = HandleUtil.unique("materialized-only");
    const content = "Serve from local materialized prompt";
    // First create the prompt on the server
    await langwatch.prompts.create({ handle, prompt: content });

    const temp = TempDirUtil.withTempDir();
    const cli = new CliRunner({ cwd: temp.dir });

    try {
      process.chdir(temp.dir);
      const { result: prompt, calls } = await withFetchSpy(() => {
        return runMaterializedOnlyPolicy(handle, cli);
      });
      expect(prompt).toBeTruthy();
      expect(prompt.handle).toBe(handle);
      expect(prompt.prompt ?? "").toContain(content);
      expect(calls).toBe(0);
    } finally {
      temp.dispose();
    }
  }, 60_000);

  it("cache TTL expires and refetches after TTL", async () => {
    const handle = HandleUtil.unique("cache-ttl-expire");
    await langwatch.prompts.create({ handle, prompt: "Cache TTL happy path" });

    const { calls: callsFirst } = await withFetchSpy(async () => {
      return runCacheTtlPolicy(handle, 0.0005);
    });
    expect(callsFirst).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 75));

    const { calls: callsSecond } = await withFetchSpy(async () => {
      return runCacheTtlPolicy(handle, 0.0005);
    });
    expect(callsSecond).toBeGreaterThan(0);

    await langwatch.prompts.delete(handle);
  }, 60_000);
});
