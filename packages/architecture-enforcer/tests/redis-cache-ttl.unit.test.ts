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

const WRITE_CALL =
  /(?:this\.#?redis|\bredis)\??\.(set|setex|psetex|setnx|getset|hset|hsetnx|hmset|mset|msetnx|incr|incrby|incrbyfloat|decr|decrby|hincrby|hincrbyfloat|sadd|zadd|lpush|rpush|append|setrange|pfadd|eval|evalsha|multi|pipeline)\(/g;
const EXPIRY_OPTION = /["'](?:EX|PX|EXAT|PXAT)["']/;
const SCRIPT_COMMAND = /redis\.call\(\s*["'](\w+)["']/gi;
const SCRIPT_NON_WRITES = new Set(["GET", "DEL", "UNLINK", "EXISTS", "TTL", "PTTL"]);

const cacheRepositories = (): string[] =>
  execFileSync("git", ["ls-files", "--", "*/redis.*cache*.repository.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
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
    const commands = [...args.matchAll(SCRIPT_COMMAND)].map(([, name = ""]) => name.toUpperCase());
    const writes = commands.some((name) => !SCRIPT_NON_WRITES.has(name));
    return !writes || commands.some((name) => name.endsWith("EXPIRE")) || /'(?:EX|PX)'/.test(args);
  }
  return false;
}

function writesWithoutExpiry(file: string): string[] {
  const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  const offenders: string[] = [];

  for (const match of source.matchAll(WRITE_CALL)) {
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
    expect(cacheRepositories().length).toBeGreaterThanOrEqual(14);
  });

  /** @scenario "A Redis cache repository writes no key without its expiry" */
  it("writes every key with its expiry in the same atomic command", () => {
    expect(cacheRepositories().flatMap(writesWithoutExpiry)).toEqual([]);
  });
});
