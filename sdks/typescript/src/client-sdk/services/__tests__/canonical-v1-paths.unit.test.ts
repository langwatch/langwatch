/**
 * The canonical-generation guard for every request path the SDK builds.
 *
 * specs/typescript-sdk/canonical-v1-request-paths.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { InternalConfig } from "@/client-sdk/types";
import type { LangwatchApiClient } from "@/internal/api/client";
import { LOGS_PATH, METRICS_PATH, TRACES_PATH } from "@/internal/constants";
import { PromptsApiService } from "../prompts/prompts-api.service";

const SDK_SRC = resolve(__dirname, "../../..");

/**
 * The families the served surface answers for at `/api/v1` as well as bare
 * (packages/api/adrs/002 section 1). Everything else keeps its bare address.
 */
const V1_FAMILIES = new Set(
  `agent-cache analytics annotations api-keys bug-reports coding-agent dashboards dataset dspy
   evaluations evaluators events experiment experiments governance graphs groups guardrails langy me
   model-defaults model-providers monitors optimization organization organizations playground
   prompts role-bindings roles scenario-events scenarios scim-tokens simulation-runs suites
   teams trace traces trigger triggers workflows`.split(/\s+/),
);

const BARE_PATH = /\/api\/([a-zA-Z0-9_-]+)((?:\/(?:\$\{[^}]*\}|[a-zA-Z0-9_{}.-]+))*)/g;
const VERSION_SEGMENT = /^v\d+$/;

/** Routes the document keeps bare because they have no `/api/v1` twin. */
const BARE_ONLY = [/^\/api\/traces\/[^/]+\/transcript$/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

function bareFamilyPaths(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(BARE_PATH)) {
      if (!V1_FAMILIES.has(match[1]!)) continue;
      // A path already naming a generation of its own — `/api/evaluations/v3`
      // — is mounted once and keeps the address it has.
      const segments = (match[2] ?? "").split("/").filter(Boolean);
      if (segments.some((segment) => VERSION_SEGMENT.test(segment))) continue;
      if (BARE_ONLY.some((bare) => bare.test(match[0]!.replace(/\$\{[^}]*\}/g, "x")))) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${file.slice(SDK_SRC.length + 1)}:${line} ${match[0]}`);
    }
  }
  return offenders;
}

describe("given the request paths the TypeScript SDK builds", () => {
  describe("when the client services and CLI commands are read", () => {
    /** @scenario "Hand-written service request paths are v1-form" */
    it("addresses no REST family at its bare /api address", () => {
      const files = [
        ...sourceFiles(join(SDK_SRC, "client-sdk")),
        ...sourceFiles(join(SDK_SRC, "cli")),
      ];
      // A guard that reads no files would pass while proving nothing.
      expect(files.length).toBeGreaterThan(200);

      expect(bareFamilyPaths(files)).toEqual([]);
    });
  });

  describe("when the generated OpenAPI client is read", () => {
    /** @scenario "The generated OpenAPI client is v1-form" */
    it("addresses every documented family key under /api/v1", () => {
      const generated = join(SDK_SRC, "internal/generated/openapi/api-client.ts");
      const keys = readFileSync(generated, "utf8")
        .split("\n")
        .flatMap((line) => /^ {4}"(\/api\/[^"]*)":/.exec(line)?.[1] ?? []);
      expect(keys.length).toBeGreaterThan(100);

      // A key the document also publishes under `/api/v1` is the same logical
      // route at two addresses; the offence is a family that has no twin at all.
      const published = new Set(keys);
      const bare = keys.filter(
        (key) =>
          V1_FAMILIES.has(key.split("/")[2] ?? "") &&
          !published.has(`/api/v1${key.slice(4)}`) &&
          !BARE_ONLY.some((bare) => bare.test(key)),
      );
      expect(bare).toEqual([]);
    });
  });

  describe("when the SDK reads a prompt by handle", () => {
    /** @scenario "A prompt read goes out at the canonical address" */
    it("requests the canonical /api/v1/prompts address", async () => {
      const get = vi.fn().mockResolvedValue({ data: { id: "p_1" }, error: undefined });
      const service = new PromptsApiService({
        langwatchApiClient: { GET: get } as unknown as LangwatchApiClient,
        logger: mock(),
      } as InternalConfig);

      await service.get("greeting-bot");

      expect(get.mock.calls[0]?.[0]).toBe("/api/v1/prompts/{id}");
    });
  });

  describe("when the telemetry exporter paths are read", () => {
    /** @scenario "The OTLP exporter paths are left alone" */
    it("keeps the generation the OTLP family already carries", () => {
      expect([TRACES_PATH, LOGS_PATH, METRICS_PATH]).toEqual([
        "/api/otel/v1/traces",
        "/api/otel/v1/logs",
        "/api/otel/v1/metrics",
      ]);
    });
  });
});
