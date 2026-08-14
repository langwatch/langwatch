/**
 * @vitest-environment node
 *
 * Guards the boundary that lets the scenario child's execution contract move to
 * its own package: `execution/types.ts` may only be imported from inside the
 * child's own tree.
 *
 * This is an architectural guard, not a snapshot. It reads the real source
 * files, so a new import anywhere in the app fails it — which is the point. The
 * one thing outside the child that needed a piece of that file,
 * `FieldMappingSchema`, now lives in `../field-mapping`; anything else that
 * finds itself reaching in should move there too rather than widening this.
 *
 * @see specs/scenarios/child-execution-contract.feature
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { suiteTargetSchema } from "../../suites/types";
import { PromptConfigDataSchema } from "../execution/types";
import { FieldMappingSchema } from "../field-mapping";

const SELF = fileURLToPath(import.meta.url);
const SRC = path.resolve(path.dirname(SELF), "../../..");

/** The child's own tree, relative to `src/`. Imports from here are expected. */
const EXECUTION_TREE = "server/scenarios/execution/";

/** Every way a file can name the contract module, alias or relative. */
const CONTRACT_SPECIFIERS = [
  "~/server/scenarios/execution/types",
  "server/scenarios/execution/types",
];

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

const rel = (file: string) =>
  path.relative(SRC, file).split(path.sep).join("/");

describe("scenario child execution contract", () => {
  describe("when the whole application source tree is scanned", () => {
    /** @scenario Nothing outside the child's own tree imports the execution contract */
    it("finds importers of the contract only inside the execution tree", () => {
      const outsiders = walk(SRC)
        // This file names the specifiers in order to search for them.
        .filter((file) => file !== SELF)
        .filter((file) => {
          const source = fs.readFileSync(file, "utf8");
          return CONTRACT_SPECIFIERS.some((specifier) =>
            source.includes(`"${specifier}"`),
          );
        })
        .map(rel)
        .filter((file) => !file.startsWith(EXECUTION_TREE));

      expect(outsiders).toEqual([]);
    });

    /** @scenario The shared field mapping schema carries no framework dependency */
    it("keeps the shared field mapping module on zod alone", () => {
      const source = fs.readFileSync(
        path.join(SRC, "server", "scenarios", "field-mapping.ts"),
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
