/**
 * The rows of a comparison: how they open, grow, and tell two equal targets
 * apart.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { describe, expect, it } from "vitest";
import {
  addCompareRow,
  compareRowParameters,
  hasDuplicateCompareRows,
  initialCompareRows,
  MAX_COMPARE_ROWS,
} from "../run/compare-rows";
import { TARGET_COLORS, targetColor } from "../shared/target-colors";

const DEV = { id: "agent_dev", name: "dev-agent", type: "http" as const };
const PROD = { id: "agent_prod", name: "prod-agent", type: "http" as const };

describe("initialCompareRows", () => {
  describe("when the project offers another agent", () => {
    /** @scenario "The second row defaults to the next agent with the same parameter line" */
    it("opens on the chosen agent with its line, then the next agent with the same line", () => {
      expect(
        initialCompareRows({
          target: { type: "http", id: "agent_dev" },
          parameterLine: "locale=de",
          agents: [DEV, PROD],
        }),
      ).toEqual([
        {
          target: { type: "http", id: "agent_dev" },
          parameterLine: "locale=de",
        },
        {
          target: { type: "http", id: "agent_prod" },
          parameterLine: "locale=de",
        },
      ]);
    });

    it("skips the chosen agent whatever its place in the list", () => {
      const rows = initialCompareRows({
        target: { type: "http", id: "agent_prod" },
        parameterLine: "",
        agents: [DEV, PROD],
      });

      expect(rows[1]?.target.id).toBe("agent_dev");
    });
  });

  describe("when the project offers one agent only", () => {
    /** @scenario "The second row defaults to the same agent when there is no other" */
    it("opens the second row on the same agent with the same line", () => {
      expect(
        initialCompareRows({
          target: { type: "http", id: "agent_dev" },
          parameterLine: "locale=de",
          agents: [DEV],
        }),
      ).toEqual([
        {
          target: { type: "http", id: "agent_dev" },
          parameterLine: "locale=de",
        },
        {
          target: { type: "http", id: "agent_dev" },
          parameterLine: "locale=de",
        },
      ]);
    });
  });

  describe("when no agent was chosen yet", () => {
    it("opens on the first agent of the list", () => {
      const rows = initialCompareRows({
        target: null,
        parameterLine: "",
        agents: [DEV, PROD],
      });

      expect(rows.map((row) => row.target.id)).toEqual([
        "agent_dev",
        "agent_prod",
      ]);
    });
  });
});

describe("addCompareRow", () => {
  describe("when the section holds two rows", () => {
    /** @scenario "A row is added as a copy of the last row, up to four" */
    it("adds a copy of the last row, agent and line", () => {
      const rows = addCompareRow([
        { target: { type: "http", id: "agent_dev" }, parameterLine: "a=1" },
        { target: { type: "http", id: "agent_prod" }, parameterLine: "b=2" },
      ]);

      expect(rows).toHaveLength(3);
      expect(rows[2]).toEqual({
        target: { type: "http", id: "agent_prod" },
        parameterLine: "b=2",
      });
    });
  });

  describe("when the section already holds the most rows a run compares", () => {
    it("adds none", () => {
      const full = Array.from({ length: MAX_COMPARE_ROWS }, () => ({
        target: { type: "http" as const, id: "agent_dev" },
        parameterLine: "",
      }));

      expect(addCompareRow(full)).toHaveLength(MAX_COMPARE_ROWS);
    });
  });
});

describe("hasDuplicateCompareRows", () => {
  describe("when two rows name the same agent with the same values", () => {
    /** @scenario "Two rows with the same agent and the same parameters are refused" */
    it("finds them, whatever the order the pairs were written in", () => {
      expect(
        hasDuplicateCompareRows([
          {
            target: { type: "http", id: "agent_dev" },
            parameterLine: "a=1, b=2",
          },
          {
            target: { type: "http", id: "agent_dev" },
            parameterLine: "b=2, a=1",
          },
        ]),
      ).toBe(true);
    });
  });

  describe("when the same agent runs with different values", () => {
    it("finds none", () => {
      expect(
        hasDuplicateCompareRows([
          {
            target: { type: "http", id: "agent_dev" },
            parameterLine: "model=a",
          },
          {
            target: { type: "http", id: "agent_dev" },
            parameterLine: "model=b",
          },
        ]),
      ).toBe(false);
    });
  });
});

describe("compareRowParameters", () => {
  describe("when the line is empty", () => {
    it("sends nothing", () => {
      expect(
        compareRowParameters({
          target: { type: "http", id: "agent_dev" },
          parameterLine: "",
        }),
      ).toBeUndefined();
    });
  });

  describe("when the line holds pairs", () => {
    it("sends them parsed", () => {
      expect(
        compareRowParameters({
          target: { type: "http", id: "agent_dev" },
          parameterLine: "model=gpt-5-mini, temperature=0.2",
        }),
      ).toEqual({ model: "gpt-5-mini", temperature: 0.2 });
    });
  });
});

describe("targetColor", () => {
  it("colours a target by its position and wraps after the palette", () => {
    expect(targetColor(0)).toBe(TARGET_COLORS[0]);
    expect(targetColor(1)).toBe(TARGET_COLORS[1]);
    expect(targetColor(TARGET_COLORS.length)).toBe(TARGET_COLORS[0]);
  });
});
