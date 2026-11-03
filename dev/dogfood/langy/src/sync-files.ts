/**
 * Reads the scenario files and the run plan file. A malformed file stops the sync before any
 * write, naming the file and the field.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { RunPlanSpec, ScenarioParameter, ScenarioSpec } from "./sync-diff.ts";

type Json = Record<string, unknown>;

function fail({ source, message }: { source: string; message: string }): never {
  throw new Error(`${source}: ${message}`);
}

function asObject({ value, source }: { value: unknown; source: string }): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail({ source, message: "must be a JSON object" });
  }
  return value as Json;
}

function text({ json, key, source }: { json: Json; key: string; source: string }): string {
  const value = json[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail({ source, message: `"${key}" must be a non-empty string` });
  }
  return value;
}

function texts({ json, key, source }: { json: Json; key: string; source: string }): string[] {
  const value = json[key] ?? [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail({ source, message: `"${key}" must be a list of strings` });
  }
  return value as string[];
}

function optional<T extends "number" | "string">({
  json,
  key,
  type,
  source,
}: {
  json: Json;
  key: string;
  type: T;
  source: string;
}): (T extends "number" ? number : string) | null {
  const value = json[key] ?? null;
  if (value !== null && typeof value !== type) {
    fail({ source, message: `"${key}" must be a ${type} or absent` });
  }
  return value as (T extends "number" ? number : string) | null;
}

function parameters({ json, source }: { json: Json; source: string }): ScenarioParameter[] {
  const value = json.parameters ?? [];
  if (!Array.isArray(value)) fail({ source, message: `"parameters" must be a list` });
  return value.map((item, index) => {
    const parameter = asObject({ value: item, source: `${source} parameters[${index}]` });
    text({ json: parameter, key: "name", source: `${source} parameters[${index}]` });
    return parameter as unknown as ScenarioParameter;
  });
}

/** One scenario file; absent optional fields read as the server's defaults. */
export function parseScenarioSpec({ raw, source }: { raw: string; source: string }): ScenarioSpec {
  const json = asObject({ value: JSON.parse(raw), source });
  return {
    name: text({ json, key: "name", source }),
    situation: text({ json, key: "situation", source }),
    criteria: texts({ json, key: "criteria", source }),
    labels: texts({ json, key: "labels", source }),
    parameters: parameters({ json, source }),
    maxTurns: optional({ json, key: "maxTurns", type: "number", source }),
    minTurns: optional({ json, key: "minTurns", type: "number", source }),
    simulatorModel: optional({ json, key: "simulatorModel", type: "string", source }),
    judgeModel: optional({ json, key: "judgeModel", type: "string", source }),
  };
}

/** The run plan file. */
export function parseRunPlanSpec({ raw, source }: { raw: string; source: string }): RunPlanSpec {
  const json = asObject({ value: JSON.parse(raw), source });
  const repeatCount = json.repeatCount ?? 1;
  if (typeof repeatCount !== "number" || !Number.isInteger(repeatCount) || repeatCount < 1) {
    fail({ source, message: `"repeatCount" must be a whole number of at least 1` });
  }
  return {
    name: text({ json, key: "name", source }),
    description: optional({ json, key: "description", type: "string", source }),
    agent: text({ json, key: "agent", source }),
    repeatCount,
  };
}

/** Every `*.json` in the directory, by file name, so the plan's order follows the files. */
export function readScenarioSpecs({ dir }: { dir: string }): ScenarioSpec[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .map((file) => parseScenarioSpec({ raw: readFileSync(join(dir, file), "utf8"), source: file }));
}

export function readRunPlanSpec({ file }: { file: string }): RunPlanSpec {
  return parseRunPlanSpec({ raw: readFileSync(file, "utf8"), source: file });
}
