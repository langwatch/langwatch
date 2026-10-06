/**
 * Structural proof of the Agent feature boundary: what its contract and browser may load, what
 * Workflow may reach of it and what must stay out of it.
 * @see modules/agent/specs/package-boundary.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const AGENT_ROOT = join(import.meta.dirname, "..", "..", "..");
const WORKFLOW_PROCESS_SRC = join(AGENT_ROOT, "..", "workflow", "process", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]!);
}

function offendersIn(dir: string, banned: RegExp): string[] {
  return sourceFiles(dir).flatMap((file) =>
    importsOf(file)
      .filter((spec) => banned.test(spec))
      .map((spec) => `${file}: ${spec}`),
  );
}

function dependenciesOf(half: "contract" | "browser"): string[] {
  const manifest = JSON.parse(readFileSync(join(AGENT_ROOT, half, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {});
}

const SERVER_SIDE =
  /^(@prisma\/|@langwatch\/[a-z-]+-process$|@langwatch\/prisma-client|node:|react$|ioredis|hono|@trpc\/server)/;

describe("the Agent feature boundary", () => {
  describe("when a browser or another feature imports the agent contract", () => {
    /** @scenario "Agent contract values are portable" */
    it("declares and imports no Prisma, React, app alias or server implementation", () => {
      const declared = dependenciesOf("contract").filter((name) => SERVER_SIDE.test(name));
      const imported = offendersIn(
        join(AGENT_ROOT, "contract", "src"),
        /^(~\/|@\/)|\.\.\/\.\.\/process/,
      ).concat(offendersIn(join(AGENT_ROOT, "contract", "src"), SERVER_SIDE));

      expect(declared).toEqual([]);
      expect(imported).toEqual([]);
    });
  });

  describe("when the app composes an Agents screen", () => {
    /** @scenario "Agents web is browser safe" */
    it("depends on no Agents server, Prisma, Node runtime or app source", () => {
      const declared = dependenciesOf("browser").filter(
        (name) => name.endsWith("-process") || name.startsWith("@prisma/"),
      );
      const imported = offendersIn(
        join(AGENT_ROOT, "browser", "src"),
        /^(@prisma\/|@langwatch\/[a-z-]+-process$|node:|~\/|@\/)/,
      );

      expect(declared).toEqual([]);
      expect(imported).toEqual([]);
    });
  });

  describe("when Workflow persists a linked agent's field mappings", () => {
    /** @scenario "Workflow mapping updates cannot bypass Agent ownership" */
    it("imports no Agent repository, Agent process package or generated Agent delegate", () => {
      const imported = offendersIn(WORKFLOW_PROCESS_SRC, /agent-process|agent\.repository/);
      const delegates = sourceFiles(WORKFLOW_PROCESS_SRC).filter((file) =>
        /\b(?:prisma|db|tx|client)\.agent\b/.test(readFileSync(file, "utf8")),
      );

      expect(imported).toEqual([]);
      expect(delegates).toEqual([]);
    });
  });

  describe("when the Agents package is extracted", () => {
    /** @scenario "Coding-agent observability remains a separate feature" */
    it("carries no coding-agent contract, process or browser dependency", () => {
      const imported = ["contract", "process", "browser"].flatMap((half) =>
        offendersIn(join(AGENT_ROOT, half, "src"), /coding-agent/),
      );
      const declared = (["contract", "browser"] as const)
        .flatMap((half) => dependenciesOf(half))
        .filter((name) => name.includes("coding-agent"));

      expect(imported).toEqual([]);
      expect(declared).toEqual([]);
    });
  });
});
