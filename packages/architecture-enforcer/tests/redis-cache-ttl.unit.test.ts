/**
 * Redis runs noeviction, so a cache key without an expiry is never reclaimed.
 * Every Redis cache repository writes its TTL in the same command (ARCHITECTURE §7).
 * @see specs/server/redis-cache-ttl.feature
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const WRITE_METHODS =
  "set|setex|psetex|setnx|getset|hset|hsetnx|hmset|mset|msetnx|incr|incrby|incrbyfloat|decr|decrby|hincrby|hincrbyfloat|sadd|zadd|lpush|rpush|append|setrange|pfadd|eval|evalsha|multi|pipeline";
/** A name declared with a Redis client type, so the check never depends on what it is called. */
const CLIENT_DECLARATION =
  /(#?[A-Za-z_$][\w$]*)\??\s*:\s*[^=;{}()]*?(?:\w*Redis(?:Connection)?\b|\bCluster\b|\["redis"\])/g;
const EXPIRY_OPTION = /["'](?:EX|PX|EXAT|PXAT)["']/;
const SCRIPT_COMMAND = /redis\.call\(\s*["'](\w+)["']/gi;
const SCRIPT_NON_WRITES = new Set(["GET", "DEL", "UNLINK", "EXISTS", "TTL", "PTTL"]);

const cacheRepositories = (): string[] =>
  execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "*/redis.*cache*.repository.ts",
      "*/redis.better-auth-secondary-storage.repository.ts",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter((file) => file !== "" && !file.includes("/__tests__/"));

/** The text between the parenthesis at `open` and the one that closes it. */
function argumentsAt(source: string, open: number): string {
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    if (source[at] === "(") depth++;
    if (source[at] === ")" && --depth === 0) return source.slice(open + 1, at);
  }
  return source.slice(open + 1);
}

function expiresInTheSameCommand(source: string, method: string, open: number): boolean {
  const args = argumentsAt(source, open);
  if (method === "setex" || method === "psetex") return true;
  if (method === "set") return EXPIRY_OPTION.test(args);
  if (method === "multi") {
    const transaction = source.slice(open, source.indexOf(".exec(", open));
    return /\.p?expire\(/.test(transaction) || EXPIRY_OPTION.test(transaction);
  }
  if (method === "eval" || method === "evalsha") {
    const script = scriptOf(source, args);
    const commands = [...script.matchAll(SCRIPT_COMMAND)].map(([, name = ""]) =>
      name.toUpperCase(),
    );
    const writes = commands.some((name) => !SCRIPT_NON_WRITES.has(name));
    return (
      !writes || commands.some((name) => name.endsWith("EXPIRE")) || /'(?:EX|PX)'/.test(script)
    );
  }
  return false;
}

/** The script an eval runs: inline, or the constant its first argument names. */
function scriptOf(source: string, args: string): string {
  const name = /^\s*([A-Za-z_$][\w$]*)\s*,/.exec(args)?.[1];
  const constant =
    name && new RegExp(`const\\s+${name}\\s*=\\s*([\`'"])([\\s\\S]*?)\\1`).exec(source);
  return constant ? (constant[2] ?? "") : args;
}

function writeCalls(source: string): RegExp | undefined {
  const clients = new Set([...source.matchAll(CLIENT_DECLARATION)].map(([, name = ""]) => name));
  if (clients.size === 0) return undefined;
  const names = [...clients].map((name) => name.replace(/\$/g, "\\$")).join("|");
  return new RegExp(`(?<![\\w$.#])(?:this\\.)?(?:${names})[!?]*\\.(${WRITE_METHODS})\\(`, "g");
}

function writesWithoutExpiry(file: string): string[] {
  return offendersIn(file, readFileSync(path.join(REPO_ROOT, file), "utf8"));
}

function offendersIn(file: string, source: string): string[] {
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const offenders: string[] = [];
  const calls = writeCalls(source);
  if (!calls) return [`${file} declares no Redis client the check can follow`];

  for (const match of source.matchAll(calls)) {
    const [call, method = ""] = match;
    const at = match.index ?? 0;
    if (!expiresInTheSameCommand(source, method, at + call.length - 1)) {
      offenders.push(`${file}:${lineOf(at)} ${method} writes without a TTL`);
    }
  }
  for (const match of source.matchAll(/new RedisCachedFoldStore(?:<[^>]*>)?\(/g)) {
    const at = match.index ?? 0;
    if (!/\bttlSeconds\s*:/.test(argumentsAt(source, at + match[0].length - 1))) {
      offenders.push(`${file}:${lineOf(at)} RedisCachedFoldStore without a named ttlSeconds`);
    }
  }
  return offenders;
}

describe("given the Redis cache repositories", () => {
  /** @scenario "A Redis cache repository writes no key without its expiry" */
  it("finds them, so the check below cannot pass on an empty list", () => {
    expect(cacheRepositories().length).toBeGreaterThanOrEqual(16);
  });

  /** @scenario "A Redis cache repository writes no key without its expiry" */
  it("writes every key with its expiry in the same atomic command", () => {
    expect(cacheRepositories().flatMap(writesWithoutExpiry)).toEqual([]);
  });
});

describe("given a repository whose Redis client has another name", () => {
  /** @scenario "The expiry check reads every Redis-writing repository, whatever its client is called" */
  it("still finds a write without an expiry", () => {
    const source = [
      "export class Example {",
      "  constructor(private readonly connection: RedisConnection) {}",
      "  async hold(key: string) {",
      '    await this.connection!.set(key, "1");',
      "  }",
      "}",
    ].join("\n");

    expect(offendersIn("example.ts", source)).toEqual(["example.ts:4 set writes without a TTL"]);
  });

  it("reads the script a named constant holds", () => {
    const source = [
      "const COUNT = `return redis.call('INCR', KEYS[1])`;",
      "export function count(client: Redis) {",
      "  return client.eval(COUNT, 1, 'key');",
      "}",
    ].join("\n");

    expect(offendersIn("example.ts", source)).toEqual(["example.ts:3 eval writes without a TTL"]);
  });

  it("ignores an in-memory map beside the client", () => {
    const source = [
      "export class Example {",
      "  readonly #memory = new Map<string, string>();",
      "  constructor(private readonly redis: RedisConnection) {}",
      "  async hold(key: string) {",
      '    this.#memory.set(key, "1");',
      '    await this.redis.set(key, "1", "EX", 5);',
      "  }",
      "}",
    ].join("\n");

    expect(offendersIn("example.ts", source)).toEqual([]);
  });
});
