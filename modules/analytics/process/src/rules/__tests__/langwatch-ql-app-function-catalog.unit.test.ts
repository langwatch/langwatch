/**
 * The app-function catalog, and what the schema endpoint publishes from it.
 * The names are a global, unversioned public API from the first deploy, so a
 * duplicate is a broken deploy. @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LangWatchQLSchemaService } from "../../services/langwatch-ql-schema.service.ts";
import {
  LWQL_APP_FUNCTION_CATALOG,
  findLangWatchQLAppFunctions,
  isLangWatchQLAppFunction,
  lwqlAppFunctionCap,
  lwqlAppFunctionKeyParameters,
  lwqlAppFunctionNames,
  lwqlAppFunctionSignature,
} from "../langwatch-ql-app-function-catalog.rules.ts";
import {
  LWQL_APP_FUNCTION_ENCODINGS,
  LWQL_APP_FUNCTION_KEY_CAPS,
  LWQL_APP_FUNCTION_KEY_KINDS,
} from "../langwatch-ql-app-function-shapes.rules.ts";

const DATABASE = "analytics";

const schema = LangWatchQLSchemaService.create();

/** A caller holding every content permission. */
const FULL: LangWatchQLProtections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/** A caller holding none, which is what an unresolved policy resolves to. */
const NONE: LangWatchQLProtections = {};

describe("given the app-function catalog", () => {
  describe("when its names are read", () => {
    it("holds no duplicate", () => {
      const names = lwqlAppFunctionNames();

      expect(new Set(names).size).toBe(names.length);
    });

    it("spells every name as a plain lowercase identifier", () => {
      for (const name of lwqlAppFunctionNames()) {
        expect(name, name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it("looks a name up whatever case it was written in", () => {
      expect(findLangWatchQLAppFunctions("CONVERSATION")[0]?.name).toBe("conversation");
      expect(isLangWatchQLAppFunction("  Thread_Traces  ")).toBe(true);
      expect(isLangWatchQLAppFunction("count")).toBe(false);
    });
  });

  describe("when each declaration is read", () => {
    it("declares at least one key parameter, and declares the keys first", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const roles = definition.parameters.map((parameter) => parameter.role);

        expect(lwqlAppFunctionKeyParameters(definition).length, definition.name).toBeGreaterThan(0);
        // Keys first is what lets the UDF body be "the leading arguments" and
        // the hydrator read the key from the leading tuple members.
        expect(roles.indexOf("key"), definition.name).toBe(0);
        expect(roles.lastIndexOf("key"), `${definition.name} interleaves options with keys`).toBe(
          lwqlAppFunctionKeyParameters(definition).length - 1,
        );
      }
    });

    it("spells every parameter as a plain lowercase identifier", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        for (const parameter of definition.parameters) {
          expect(parameter.name, `${definition.name}.${parameter.name}`).toMatch(
            /^[a-z][a-z0-9_]*$/,
          );
        }
      }
    });

    it("declares a known key kind and a known encoding", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        expect(LWQL_APP_FUNCTION_KEY_KINDS).toContain(definition.keyKind);
        expect(LWQL_APP_FUNCTION_ENCODINGS).toContain(definition.encoding);
      }
    });

    it("takes its cap from its key kind, never a number of its own", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        expect(lwqlAppFunctionCap(definition)).toBe(LWQL_APP_FUNCTION_KEY_CAPS[definition.keyKind]);
      }
    });

    // An eval function returns a number or a label about a text, never the
    // text, and its content was named by an expression the walk already gated.
    it("gates no eval function, whose text the walk gated where it was written", () => {
      const gated = LWQL_APP_FUNCTION_CATALOG.filter(
        (definition) => definition.kind === "eval" && definition.gates.length > 0,
      );

      expect(gated.map((definition) => definition.name)).toEqual([]);
    });

    it("gates every extraction function that returns captured content", () => {
      // `thread_traces` is the one extraction function carrying none: it
      // answers with trace ids.
      const ungated = LWQL_APP_FUNCTION_CATALOG.filter(
        (definition) => definition.kind === "extraction" && !definition.gates.includes("input"),
      );

      expect(ungated.map((definition) => definition.name)).toEqual(["thread_traces"]);
    });

    it("renders a signature naming every parameter in order", () => {
      const [definition] = findLangWatchQLAppFunctions("conversation_bounded");
      if (!definition) throw new Error("conversation_bounded left the catalog");

      expect(lwqlAppFunctionSignature(definition)).toBe(
        "conversation_bounded(thread_key, max_tokens, until_trace_id)",
      );
    });
  });

  describe("when the published examples are read", () => {
    /** @scenario "Every catalogued function is published with a runnable example" */
    it("puts a call to its own function in every example", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        expect(definition.example(DATABASE), definition.name).toContain(`${definition.name}(`);
      }
    });

    it("stays under the key cap the same function publishes", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        const limit = /LIMIT (\d+)/.exec(definition.example(DATABASE))?.[1];

        expect(limit, `${definition.name} has no LIMIT`).toBeDefined();
        expect(Number(limit)).toBeLessThanOrEqual(lwqlAppFunctionCap(definition));
      }
    });

    it("qualifies its dataset with the deployment's own database", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        expect(definition.example("elsewhere"), definition.name).toContain("FROM elsewhere.");
      }
    });
  });
});

describe("given the schema endpoint's app functions section", () => {
  describe("when the caller holds every content permission", () => {
    it("publishes one entry per catalogued function, in catalog order", () => {
      const functions = schema.describeAppFunctions({
        database: DATABASE,
        protections: FULL,
      });

      expect(functions.map((entry) => entry.name)).toEqual(lwqlAppFunctionNames());
    });

    /** @scenario "Every catalogued function is published with a runnable example" */
    it("carries the signature, return type, encoding, key kind, cap and gates", () => {
      const [entry] = schema
        .describeAppFunctions({ database: DATABASE, protections: FULL })
        .filter((candidate) => candidate.name === "conversation_bounded");

      expect(entry).toMatchObject({
        name: "conversation_bounded",
        signature: "conversation_bounded(thread_key, max_tokens, until_trace_id)",
        returns: "Nullable(String)",
        encoding: "text",
        keyKind: "thread",
        cap: LWQL_APP_FUNCTION_KEY_CAPS.thread,
        gates: ["input", "output"],
        available: true,
      });
      expect(entry?.exampleSql).toContain("conversation_bounded(");
    });

    it("marks a JSON-returning function as JSON, so a consumer parses it back", () => {
      const functions = schema.describeAppFunctions({
        database: DATABASE,
        protections: FULL,
      });
      const encodings = new Map(functions.map((entry) => [entry.name, entry.encoding]));

      expect(encodings.get("llm_messages")).toBe("json");
      expect(encodings.get("trace_json")).toBe("json");
      expect(encodings.get("conversation")).toBe("text");
    });

    it("withholds an eval function until this project may judge at all", () => {
      const byName = new Map(
        schema
          .describeAppFunctions({ database: DATABASE, protections: FULL })
          .map((entry) => [entry.name, entry.available]),
      );

      expect(byName.get("eval")).toBe(false);
      expect(
        new Map(
          schema
            .describeAppFunctions({
              database: DATABASE,
              protections: FULL,
              isInstantEvalsEnabled: true,
            })
            .map((entry) => [entry.name, entry.available]),
        ).get("eval"),
      ).toBe(true);
    });
  });

  describe("when the caller holds no content permission", () => {
    /** @scenario "The schema lists a gated function rather than hiding it" */
    it("lists every gated function with available false rather than hiding it", () => {
      const functions = schema.describeAppFunctions({
        database: DATABASE,
        protections: NONE,
      });

      expect(functions.map((entry) => entry.name)).toEqual(lwqlAppFunctionNames());
      const conversation = functions.find((entry) => entry.name === "conversation");
      expect(conversation?.available).toBe(false);
      expect(conversation?.gates).toEqual(["input", "output"]);
    });

    it("still offers the ungated function", () => {
      const functions = schema.describeAppFunctions({
        database: DATABASE,
        protections: NONE,
      });

      expect(functions.find((entry) => entry.name === "thread_traces")?.available).toBe(true);
    });
  });

  describe("when the caller holds one of two required permissions", () => {
    it("withholds a function needing both", () => {
      const functions = schema.describeAppFunctions({
        database: DATABASE,
        protections: { canSeeCapturedInput: true },
      });
      const byName = new Map(functions.map((entry) => [entry.name, entry.available]));

      expect(byName.get("llm_input_messages")).toBe(true);
      expect(byName.get("llm_output_messages")).toBe(false);
      expect(byName.get("conversation")).toBe(false);
    });
  });
});
