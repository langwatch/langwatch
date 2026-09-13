/**
 * The names a run carries that nothing in it declares.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { describe, expect, it } from "vitest";
import type { DeclaredParameter } from "~/components/suites/useRunSuite";
import {
  lineWithoutUndeclared,
  undeclaredNamesOnLine,
  undeclaredNamesOnRows,
  undeclaredParameterMessage,
} from "../undeclared-parameters";

const declares = (...names: string[]): DeclaredParameter[] =>
  names.map((name) => ({ name, source: "agent" as const }));

describe("undeclaredNamesOnLine", () => {
  describe("given a line whose names are all declared", () => {
    it("finds nothing", () => {
      expect(
        undeclaredNamesOnLine({
          line: "model=gpt-5-mini, plan=free",
          definitions: declares("model", "plan"),
        }),
      ).toEqual([]);
    });
  });

  describe("given a line the chosen agent cannot read", () => {
    it("names every one of them, once each", () => {
      expect(
        undeclaredNamesOnLine({
          line: "model=gpt-5-mini, plan=free, plan=pro",
          definitions: declares("model"),
        }),
      ).toEqual(["plan"]);
    });
  });

  describe("given a fragment with no value yet", () => {
    it("reads nothing from it", () => {
      expect(
        undeclaredNamesOnLine({ line: "mod", definitions: declares("model") }),
      ).toEqual([]);
    });
  });
});

describe("undeclaredNamesOnRows", () => {
  describe("given a secret row and an empty row beside a plain one", () => {
    it("reads the plain row alone", () => {
      expect(
        undeclaredNamesOnRows({
          rows: [
            { name: "api_token", value: "t", secret: true },
            { name: "", value: "", secret: false },
            { name: "seats", value: "12", secret: false },
          ],
          definitions: declares("model"),
        }),
      ).toEqual(["seats"]);
    });
  });
});

describe("lineWithoutUndeclared", () => {
  describe("given a remembered line and an agent that reads part of it", () => {
    it("keeps the pairs the run declares and drops the rest", () => {
      expect(
        lineWithoutUndeclared({
          line: "model=gpt-5-mini, plan=free",
          definitions: declares("model"),
        }),
      ).toBe("model=gpt-5-mini");
    });
  });

  describe("given an agent that reads none of it", () => {
    it("leaves nothing", () => {
      expect(
        lineWithoutUndeclared({
          line: "model=gpt-5-mini, plan=free",
          definitions: [],
        }),
      ).toBe("");
    });
  });
});

describe("undeclaredParameterMessage", () => {
  describe("given one name and a chosen agent", () => {
    it("names the agent it is not declared by", () => {
      expect(
        undeclaredParameterMessage({
          names: ["plan"],
          targetLabel: "ACME Support Agent",
        }),
      ).toBe(
        "plan is not declared by any scenario in this run, and not by ACME Support Agent. Remove it, or declare it on the scenario or on the agent.",
      );
    });
  });

  describe("given several names and no chosen agent", () => {
    it("reads them together", () => {
      expect(
        undeclaredParameterMessage({
          names: ["model", "plan"],
          targetLabel: null,
        }),
      ).toContain("model, plan are not declared by any scenario in this run.");
    });
  });
});
