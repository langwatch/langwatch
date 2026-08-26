/**
 * @vitest-environment node
 *
 * Guards the boundary that removes the scenario child's execution contract
 * from the application: its old deep module path may not be imported.
 *
 * This is an architectural guard, not a snapshot. It reads the real source
 * files, so a new import anywhere in the app fails it — which is the point. The
 * one thing outside the child that needed a piece of that file,
 * `FieldMappingSchema`, now lives in the scenario contract; anything else that
 * finds itself reaching in should move there too rather than widening this.
 *
 * @see specs/scenarios/child-execution-contract.feature
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { FieldMappingSchema, PromptConfigDataSchema } from "@langwatch/scenario-contract";
import { suiteTargetSchema } from "@langwatch/suite-contract";

const SELF = fileURLToPath(import.meta.url);
const SRC = path.resolve(path.dirname(SELF), "../../..");

const LEGACY_EXECUTION_TYPE_SPECIFIER = "server/scenarios/execution/types";

const isSource = (file: string) =>
  /\.(?:mts|cts|tsx?)$/.test(file) && !/\.d\.(?:mts|cts|ts)$/.test(file);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isSource(full)) out.push(full);
  }
  return out;
};

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

describe("scenario child execution contract", () => {
  describe("when the whole application source tree is scanned", () => {
    /** @scenario The app uses the package contract rather than its removed deep module */
    it("finds no importers of the removed execution types module", () => {
      const outsiders = walk(SRC)
        .filter((file) => file !== SELF)
        .filter((file) =>
          fs.readFileSync(file, "utf8").includes(`"${LEGACY_EXECUTION_TYPE_SPECIFIER}"`),
        )
        .map(rel);

      expect(outsiders).toEqual([]);
    });

    /** @scenario The shared field mapping schema carries no framework dependency */
    it("keeps the shared field mapping module on zod alone", () => {
      const source = fs.readFileSync(
        path.resolve(
          SRC,
          "../../../packages/features/scenario/contract/src/field-mapping.ts",
        ),
        "utf8",
      );

      const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1],
      );

      expect(specifiers).toEqual(["zod"]);
    });
  });

  describe("when a suite target and the child parse the same mappings", () => {
    /** @scenario A mapping accepted by the suite target schema is accepted by the child */
    it("accepts the same source and literal mappings on both sides", () => {
      const scenarioMappings = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
        context: { type: "value", value: "Use the knowledge base" },
      };

      // Prompt targets are the ones that carry mappings: an agent stores its
      // own on the agent record, and the suite schema rejects them there.
      const onSuite = suiteTargetSchema.safeParse({
        type: "prompt",
        referenceId: "prompt_1",
        scenarioMappings,
      });

      const onChild = PromptConfigDataSchema.safeParse({
        type: "prompt",
        promptId: "prompt_1",
        systemPrompt: "You answer questions.",
        messages: [{ role: "user", content: "{{query}}" }],
        scenarioMappings,
      });

      expect(onSuite.success).toBe(true);
      expect(onChild.success).toBe(true);
      expect(
        Object.values(scenarioMappings).every(
          (mapping) => FieldMappingSchema.safeParse(mapping).success,
        ),
      ).toBe(true);
    });
  });
});
