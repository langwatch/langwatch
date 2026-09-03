/**
 * What a parameter line offers, and where the declared parameters come from.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import { describe, expect, it } from "vitest";
import {
  type DeclaredParameter,
  unionParameterDefinitions,
} from "../../../../../behavior/suites/use-run-suite";
import {
  acceptParameterField,
  acceptParameterSuggestion,
  errorOnLine,
  errorOnRow,
  keySuggestions,
  PARAMETER_LINE_PLACEHOLDER,
  parameterFieldState,
  parameterPlaceholder,
  parameterSuggestionState,
  parameterSuggestions,
  valueSuggestions,
} from "../../../../sections/agent-testing/run/parameter-suggestions";

const MODEL: DeclaredParameter = {
  name: "model",
  description: "The model the agent answers with",
  type: "string",
  options: ["gpt-5-mini", "gpt-5"],
  defaultValue: "gpt-5-mini",
  source: "agent",
  agentLabel: "support-agent · production",
};

const LOCALE: DeclaredParameter = {
  name: "locale",
  description: "The language of the conversation",
  defaultValue: "en",
  source: "scenario",
};

const TOKEN: DeclaredParameter = {
  name: "api_token",
  secret: true,
  source: "scenario",
};

describe("unionParameterDefinitions", () => {
  const scenarios = [
    {
      id: "case_1",
      parameters: [{ name: "model", defaultValue: "gpt-5" }],
    },
  ];
  const agent = {
    id: "agent_1",
    name: "support-agent",
    environment: "production",
    parameters: [
      { name: "model", type: "string" as const, defaultValue: "gpt-5-mini" },
      { name: "temperature", type: "number" as const, defaultValue: 0.2 },
    ],
  };

  describe("when a scenario and an agent declare the same name", () => {
    /** @scenario "A scenario declaration wins over the agent's on a name both declare" */
    it("reads the name from the scenario and the rest from the agent, labelled", () => {
      const declared = unionParameterDefinitions({
        scenarioIds: ["case_1"],
        scenarios,
        agents: [agent],
      });

      expect(declared).toEqual([
        {
          name: "model",
          description: undefined,
          defaultValue: "gpt-5",
          secret: false,
          source: "scenario",
        },
        {
          name: "temperature",
          type: "number",
          defaultValue: 0.2,
          source: "agent",
          agentLabel: "support-agent · production",
        },
      ]);
    });
  });

  describe("when the agent is not in the run", () => {
    it("reads the scenario declarations alone", () => {
      const declared = unionParameterDefinitions({
        scenarioIds: ["case_1"],
        scenarios,
      });

      expect(declared.map((definition) => definition.name)).toEqual(["model"]);
    });
  });
});

describe("keySuggestions", () => {
  describe("when the query is empty", () => {
    /** @scenario "Key mode lists every declared parameter with its description, default and source" */
    it("lists every plain parameter with its description, default and source", () => {
      const rows = keySuggestions({
        definitions: [LOCALE, MODEL, TOKEN],
        query: "",
      });

      expect(rows).toEqual([
        expect.objectContaining({
          kind: "key",
          value: "locale",
          description: "The language of the conversation",
          defaultText: "en",
          source: "scenario",
        }),
        expect.objectContaining({
          kind: "key",
          value: "model",
          defaultText: "gpt-5-mini",
          source: "agent",
          agentLabel: "support-agent · production",
        }),
      ]);
    });
  });

  describe("when a query is typed", () => {
    it("keeps the names that match, prefix matches first", () => {
      const rows = keySuggestions({
        definitions: [LOCALE, MODEL],
        query: "mo",
      });
      expect(rows.map((row) => row.value)).toEqual(["model"]);
    });
  });
});

describe("valueSuggestions", () => {
  describe("when the parameter has a closed list of options", () => {
    /** @scenario "Value mode lists the options of a closed list" */
    it("lists the options, narrowed by the query", () => {
      expect(valueSuggestions({ definition: MODEL, query: "" }).map((r) => r.value)).toEqual([
        "gpt-5-mini",
        "gpt-5",
      ]);
      expect(valueSuggestions({ definition: MODEL, query: "gpt-5-m" }).map((r) => r.value)).toEqual(
        ["gpt-5-mini"],
      );
    });

    it("offers nothing for a query outside the list, and refuses nothing", () => {
      expect(valueSuggestions({ definition: MODEL, query: "claude" })).toEqual([]);
    });
  });

  describe("when the parameter has no options", () => {
    /** @scenario "Value mode offers the default and the typed text when the list is open" */
    it("offers the default and the typed text", () => {
      expect(valueSuggestions({ definition: LOCALE, query: "d" })).toEqual([
        expect.objectContaining({ kind: "value", value: "en" }),
        expect.objectContaining({ kind: "value", value: "d", isTyped: true }),
      ]);
    });

    it("offers the typed text once when it is the default", () => {
      expect(valueSuggestions({ definition: LOCALE, query: "en" }).map((r) => r.value)).toEqual([
        "en",
      ]);
    });
  });

  describe("when the name is not declared", () => {
    it("offers the typed text alone", () => {
      expect(valueSuggestions({ definition: undefined, query: "x" }).map((r) => r.value)).toEqual([
        "x",
      ]);
    });
  });
});

describe("acceptParameterSuggestion", () => {
  describe("when a key is accepted", () => {
    it("writes name= over the token and reopens on the values", () => {
      const text = "locale=de, mo";
      const state = parameterSuggestionState({ text, cursor: text.length });
      if (!state.open) throw new Error("expected an open state");
      const row = keySuggestions({ definitions: [MODEL], query: "mo" })[0]!;

      expect(acceptParameterSuggestion({ text, cursor: text.length, state, row })).toEqual({
        text: "locale=de, model=",
        cursor: 17,
        reopens: true,
      });
    });
  });

  describe("when a value is accepted with a pair after the cursor", () => {
    it("writes name=value over the token and leaves the rest", () => {
      const text = "model=gpt, locale=de";
      const cursor = "model=gpt".length;
      const state = parameterSuggestionState({ text, cursor });
      if (!state.open) throw new Error("expected an open state");
      const row = valueSuggestions({ definition: MODEL, query: "gpt" })[1]!;

      expect(acceptParameterSuggestion({ text, cursor, state, row })).toEqual({
        text: "model=gpt-5, locale=de",
        cursor: "model=gpt-5".length,
        reopens: false,
      });
    });
  });

  describe("when the caret sits inside the value it replaces", () => {
    it("writes over the rest of the token instead of leaving it behind", () => {
      const text = "model=gpt";
      const cursor = "model=gp".length;
      const state = parameterSuggestionState({ text, cursor });
      if (!state.open) throw new Error("expected an open state");
      const row = valueSuggestions({ definition: MODEL, query: "gp" })[1]!;

      expect(acceptParameterSuggestion({ text, cursor, state, row })).toEqual({
        text: "model=gpt-5",
        cursor: "model=gpt-5".length,
        reopens: false,
      });
    });

    it("keeps the pairs that follow the token", () => {
      const text = "model=gpt, locale=de";
      const cursor = "model=gp".length;
      const state = parameterSuggestionState({ text, cursor });
      if (!state.open) throw new Error("expected an open state");
      const row = valueSuggestions({ definition: MODEL, query: "gp" })[1]!;

      expect(acceptParameterSuggestion({ text, cursor, state, row })).toEqual({
        text: "model=gpt-5, locale=de",
        cursor: "model=gpt-5".length,
        reopens: false,
      });
    });
  });

  describe("when nothing is accepted", () => {
    /** @scenario "Free text always commits" */
    it("leaves the typed text as it is, with no suggestion to match", () => {
      const text = "model=claude";
      const state = parameterSuggestionState({ text, cursor: text.length });
      expect(parameterSuggestions({ state, definitions: [MODEL] })).toEqual([]);
      expect(text).toBe("model=claude");
    });
  });
});

describe("parameterFieldState", () => {
  describe("when the field edits a row's name", () => {
    it("is in key mode over the whole text", () => {
      expect(parameterFieldState({ mode: { kind: "name" }, text: "mo", cursor: 2 })).toEqual({
        open: true,
        mode: "field",
        query: "mo",
        tokenStart: 0,
      });
    });

    it("replaces the whole text with the accepted name", () => {
      const state = parameterFieldState({
        mode: { kind: "name" },
        text: "mo",
        cursor: 2,
      });
      if (!state.open) throw new Error("expected an open state");
      const row = keySuggestions({ definitions: [MODEL], query: "mo" })[0]!;
      expect(
        acceptParameterField({
          mode: { kind: "name" },
          text: "mo",
          cursor: 2,
          state,
          row,
        }),
      ).toEqual({ text: "model", cursor: 5, reopens: false });
    });
  });

  describe("when the field edits a row's value", () => {
    it("is in value mode for the row's name", () => {
      expect(
        parameterFieldState({
          mode: { kind: "value", name: "model" },
          text: "gpt",
          cursor: 3,
        }),
      ).toEqual({
        open: true,
        mode: "value",
        field: "model",
        query: "gpt",
        tokenStart: 0,
      });
    });

    it("stays closed while the row has no name", () => {
      expect(
        parameterFieldState({
          mode: { kind: "value", name: " " },
          text: "gpt",
          cursor: 3,
        }),
      ).toEqual({ open: false });
    });
  });
});

describe("parameterPlaceholder", () => {
  describe("when parameters are declared", () => {
    /** @scenario "The placeholder reads the first declared parameter" */
    it("reads the first plain parameter with its default", () => {
      expect(parameterPlaceholder([TOKEN, MODEL, LOCALE])).toBe("model=gpt-5-mini");
    });

    it("reads the first option when there is no default", () => {
      expect(
        parameterPlaceholder([{ ...MODEL, defaultValue: undefined, options: ["a", "b"] }]),
      ).toBe("model=a");
    });
  });

  describe("when nothing is declared", () => {
    it("reads the example line", () => {
      expect(parameterPlaceholder([])).toBe(PARAMETER_LINE_PLACEHOLDER);
    });
  });
});

describe("errorOnLine", () => {
  const error = {
    name: "model",
    value: "claude",
    message: "Choose one of gpt-5-mini, gpt-5.",
  };

  describe("when the line holds the refused pair", () => {
    it("reads the message", () => {
      expect(errorOnLine({ line: "model=claude, locale=de", error })).toBe(error.message);
    });
  });

  describe("when the line holds the name with another value", () => {
    it("reads nothing", () => {
      expect(errorOnLine({ line: "model=gpt-5", error })).toBeUndefined();
      expect(errorOnLine({ line: "model=gpt-5", error: null })).toBeUndefined();
    });
  });

  describe("when the refused value is text that looks like a number", () => {
    it("matches the pair written bare or quoted", () => {
      const refused = { name: "order", value: "007", message: "m" };
      expect(errorOnLine({ line: "order=007", error: refused })).toBe("m");
      expect(errorOnLine({ line: 'order="007"', error: refused })).toBe("m");
    });
  });

  describe("when a row is checked", () => {
    it("reads the message on the refused row alone", () => {
      expect(errorOnRow({ name: "model", value: "claude", error })).toBe(error.message);
      expect(errorOnRow({ name: "model", value: "gpt-5", error })).toBeUndefined();
    });
  });
});
