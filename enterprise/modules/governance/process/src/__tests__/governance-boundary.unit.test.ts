/**
 * Structural proof of Governance's isolation: what its contract may load, what its transports
 * may reach and which other features' internals it may not import.
 * @see enterprise/modules/governance/specs/governance.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CONTRACT_SRC = join(import.meta.dirname, "..", "..", "..", "contract", "src");
const PROCESS_SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]!);
}

function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join("\n");
}

describe("the Governance feature boundary", () => {
  describe("when a browser imports the contract root", () => {
    /** @scenario "Contracts are transport independent" */
    it("loads no server, Eventing, application, environment or generated database module", () => {
      const server =
        /^(@prisma\/|@langwatch\/(eventing|prisma-client|enterprise-governance-process)|ioredis|hono|@trpc\/server|node:)/;
      const offenders = sourceFiles(CONTRACT_SRC).flatMap((file) => [
        ...specifiersOf(file)
          .filter((spec) => server.test(spec) || spec.includes("/process/"))
          .map((spec) => `${file}: ${spec}`),
        ...(/process\.env\b/.test(codeOf(file)) ? [`${file}: reads process.env`] : []),
      ]);

      expect(offenders).toEqual([]);
    });
  });

  describe("when a request transport resolves Governance state", () => {
    /** @scenario "Request transports reuse the process-owned Governance application" */
    it("imports no service, repository, channel or database client to build one", () => {
      const transports = sourceFiles(join(PROCESS_SRC, "transport"));
      const offenders = transports.flatMap((file) =>
        specifiersOf(file)
          .filter(
            (spec) => /\.\.\/(services|repositories|channels)\//.test(spec) || /prisma/.test(spec),
          )
          .map((spec) => `${file}: ${spec}`),
      );

      expect(transports.length).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    });
  });

  describe("when Governance enforces a policy over other features' capabilities", () => {
    /** @scenario "Governance orchestrates rather than absorbs infrastructure" */
    it("reaches peers through contracts only and imports none of their process internals", () => {
      const offenders = sourceFiles(PROCESS_SRC).flatMap((file) =>
        specifiersOf(file)
          .filter(
            (spec) =>
              (/^@langwatch\/[a-z-]+-process/.test(spec) &&
                spec !== "@langwatch/enterprise-governance-process") ||
              /\/modules\/[^"]+\/process\//.test(spec),
          )
          .map((spec) => `${file}: ${spec}`),
      );

      expect(offenders).toEqual([]);
    });
  });
});
