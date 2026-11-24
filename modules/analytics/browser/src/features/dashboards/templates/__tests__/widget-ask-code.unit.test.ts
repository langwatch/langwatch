/**
 * The ask helpers every clickable chart carries: a mark is a named, keyboard-reachable button
 * with a pointer only while the host takes asks, and Enter, Space and a click all ask.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { ASK_CODE } from "../model/widget-code-parts.ts";

interface Subject {
  label: string;
  at?: string;
}
interface AskProps {
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  onClick?: () => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
}
interface Helpers {
  askable: (subject: Subject) => AskProps;
  askCursor: () => { cursor?: string };
}

function helpersOver({ canAskLangy }: { canAskLangy: boolean }) {
  const asked: Subject[] = [];
  const LW = {
    dashboardContext: { canAskLangy },
    askLangy: (subject: Subject) => asked.push(subject),
  };
  // The stored snippet is what the frame runs; evaluating it is the test.
  // oxlint-disable-next-line no-implied-eval
  const helpers = new Function("LW", `${ASK_CODE}\nreturn { askable, askCursor };`)(LW) as Helpers;
  return { helpers, asked };
}

describe("the chart ask helpers", () => {
  describe("given the host takes asks", () => {
    /** @scenario "AC124b Chart asks: a clickable bar is a keyboard-reachable button with a name" */
    it("makes a mark a focusable button named Ask Langy about its category, with a pointer", () => {
      const { helpers } = helpersOver({ canAskLangy: true });
      const props = helpers.askable({ label: "gpt-5" });

      expect(props.role).toBe("button");
      expect(props.tabIndex).toBe(0);
      expect(props["aria-label"]).toBe("Ask Langy about gpt-5");
      expect(helpers.askCursor()).toEqual({ cursor: "pointer" });
    });

    /** @scenario "AC124b Chart asks: a clickable bar is a keyboard-reachable button with a name" */
    it("asks on a click, Enter and Space, and ignores other keys", () => {
      const { helpers, asked } = helpersOver({ canAskLangy: true });
      const props = helpers.askable({ label: "errors", at: "Nov 3" });
      const press = (key: string) => props.onKeyDown?.({ key, preventDefault: () => undefined });

      props.onClick?.();
      press("Enter");
      press(" ");
      press("Tab");

      expect(asked).toEqual([
        { label: "errors", at: "Nov 3" },
        { label: "errors", at: "Nov 3" },
        { label: "errors", at: "Nov 3" },
      ]);
    });
  });

  describe("given the host does not take asks", () => {
    /** @scenario "AC124c Chart asks: a chart with nothing to investigate offers no click" */
    it("leaves a mark plain, with no role, handler or pointer", () => {
      const { helpers } = helpersOver({ canAskLangy: false });

      expect(helpers.askable({ label: "gpt-5" })).toEqual({});
      expect(helpers.askCursor()).toEqual({});
    });
  });
});
