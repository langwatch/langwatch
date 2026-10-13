import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecretsChain } from "../chain.ts";
import { SecretsResolver } from "../resolver.ts";
import { Secret, type SecretHandle } from "../secret.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-op-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A fake `op` that logs each call beside itself and answers by convention. */
const FAKE_OP = `#!/bin/sh
dir=\${0%/*}
case "$1" in
  whoami)
    echo "whoami" >> "$dir/calls.log"
    if [ -f "$dir/locked" ]; then echo "[ERROR] account is not signed in" >&2; exit 1; fi
    echo "URL: fake"; exit 0 ;;
  read)
    id=\${2##*/}
    echo "start $id" >> "$dir/calls.log"
    sleep 0.2
    echo "end $id" >> "$dir/calls.log"
    if [ "$id" = "NOT_IN_VAULT" ]; then
      echo "[ERROR] \\"NOT_IN_VAULT\\" isn't a field in the \\"LangWatch\\" item" >&2; exit 1
    fi
    printf "from-op-%s" "$id"; exit 0 ;;
esac
exit 2
`;

function opDir(options: { op: boolean; locked?: boolean }): string {
  const dir = fs.mkdtempSync(path.join(root, "bin-"));
  if (options.op) fs.writeFileSync(path.join(dir, "op"), FAKE_OP, { mode: 0o755 });
  if (options.locked) fs.writeFileSync(path.join(dir, "locked"), "");
  vi.stubEnv("PATH", options.op ? `${dir}:/usr/bin:/bin` : dir);
  return dir;
}

function calls(dir: string): string[] {
  const log = path.join(dir, "calls.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
}

function resolverOver(): SecretsResolver {
  const chain = SecretsChain.start({ environment: { IN_ENV: "abc" } })
    .withEnv()
    .withOnePassword("fake-account");
  return SecretsResolver.over(chain);
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function resolveAll(
  resolver: SecretsResolver,
  handles: readonly SecretHandle<unknown>[],
): Promise<unknown[]> {
  const scoped = resolver.scopeTo("owner", handles);
  return Promise.all(handles.map((handle) => scoped.into(handle, (value) => value)));
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const optional = [
  Secret.load("IN_ENV"),
  Secret.load("OPT_ONE", { optional: true }),
  Secret.load("OPT_TWO", { optional: true }),
];
const required = Secret.load("REQUIRED_FROM_OP");

describe("1Password, best effort", () => {
  /** @scenario "A missing op binary skips 1Password with one warning" */
  it("skips 1Password with one warning when op is not on the path", async () => {
    opDir({ op: false });

    const resolver = resolverOver();
    await resolver.preflight(optional);
    await expect(resolveAll(resolver, optional)).resolves.toEqual(["abc", undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("op not found");

    const failure = await failureOf(resolverOver().preflight([...optional, required]));
    expect(failure).toMatchObject({
      code: "secrets_preflight_failed",
      missing: ["REQUIRED_FROM_OP"],
    });
  });

  /** @scenario "A locked 1Password skips the boot's reads with one warning" */
  it("probes once, warns with the reason and reads no field when locked", async () => {
    const dir = opDir({ op: true, locked: true });

    const resolver = resolverOver();
    await resolver.preflight(optional);
    await expect(resolveAll(resolver, optional)).resolves.toEqual(["abc", undefined, undefined]);
    expect(calls(dir)).toEqual(["whoami"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("account is not signed in");

    const failure = await failureOf(resolverOver().preflight([required]));
    expect(failure).toMatchObject({ code: "secrets_preflight_failed" });
  });

  /** @scenario "An unlocked 1Password answers every needed name in parallel, once" */
  it("probes once, reads every missing name in parallel and reuses each answer", async () => {
    const dir = opDir({ op: true });
    const handles = [...optional, required];

    const resolver = resolverOver();
    await resolver.preflight(handles);
    await expect(resolveAll(resolver, handles)).resolves.toEqual([
      "abc",
      "from-op-OPT_ONE",
      "from-op-OPT_TWO",
      "from-op-REQUIRED_FROM_OP",
    ]);

    const log = calls(dir);
    expect(log.filter((line) => line === "whoami")).toHaveLength(1);
    expect(log.filter((line) => line.startsWith("start ")).toSorted()).toEqual([
      "start OPT_ONE",
      "start OPT_TWO",
      "start REQUIRED_FROM_OP",
    ]);
    const firstEnd = log.findIndex((line) => line.startsWith("end "));
    expect(log.slice(0, firstEnd).filter((line) => line.startsWith("start ")).length).toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  /** @scenario "A field missing from the item is an ordinary miss" */
  it("treats a field missing from the item as a miss, refusing it only when required", async () => {
    opDir({ op: true });
    const absent = Secret.load("NOT_IN_VAULT", { optional: true });

    const resolver = resolverOver();
    await resolver.preflight([...optional, absent]);
    await expect(resolveAll(resolver, [...optional, absent])).resolves.toEqual([
      "abc",
      "from-op-OPT_ONE",
      "from-op-OPT_TWO",
      undefined,
    ]);
    expect(warn).not.toHaveBeenCalled();

    const failure = await failureOf(resolverOver().preflight([Secret.load("NOT_IN_VAULT")]));
    expect(failure).toMatchObject({ code: "secrets_preflight_failed", missing: ["NOT_IN_VAULT"] });
  });
});
