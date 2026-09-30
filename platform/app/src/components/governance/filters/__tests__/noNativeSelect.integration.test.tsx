/**
 * @vitest-environment jsdom
 *
 * The assertion behind the no-native-select rule, held to its own honesty.
 *
 * `findNativeSelects` has to ignore exactly one thing and no more. Ark's select
 * mounts a `<select aria-hidden="true" tabindex="-1">` for autofill and plain
 * form submit; count it and the rule becomes unsatisfiable for the very
 * component the rule tells pages to use. Ignore one element too many and the
 * rule stops holding while still reporting green, which is worse than not
 * having the rule.
 *
 * The trap this file exists to keep shut: Zag marks the whole page
 * `aria-hidden="true"` while a modal is open (`hideContentBelow` in
 * `@zag-js/dialog`, via `hideOthers`). An ancestor-walking filter therefore
 * returns zero for ANY page with a dialog open — including a page rendering a
 * native select a reader can reach and operate.
 *
 * BINDS NO SCENARIO, deliberately. These are tests of the assertion itself,
 * not of any page's behaviour, and the repo does not ask a bug fix to carry a
 * feature scenario. The scenarios in the rulebook below are page-level — their
 * Givens name Home, Costs, Inventory, Agents and People — and all five pages
 * now bind them for real. Annotating these three cases as well would have
 * inflated the bound count without enforcing anything, since the parity
 * checker matches on the comment and never reads what a test asserts. Please
 * do not add `@scenario` lines here.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import {
  ChakraProvider,
  createListCollection,
  defaultSystem,
} from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValueText,
} from "~/components/ui/select";

import { findNativeSelects } from "../noNativeSelect";

const withChakra = (ui: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

afterEach(() => cleanup());

describe("the no-native-select assertion", () => {
  describe("when the page renders Ark's autofill shadow", () => {
    /**
     * The case that decides whether the rule is satisfiable at all. Not a
     * hand-written stand-in — the actual component the rule tells pages to
     * use. If this ever counts, every page that follows the rule fails it.
     */
    it("does not count the select the app's own select component mounts", () => {
      const departments = createListCollection({
        items: [
          { label: "All departments", value: "all" },
          { label: "Engineering", value: "eng" },
        ],
      });

      const { container } = withChakra(
        <SelectRoot collection={departments} name="department">
          <SelectTrigger aria-label="Department">
            <SelectValueText placeholder="All departments" />
          </SelectTrigger>
          <SelectContent portalled={false}>
            {departments.items.map((item) => (
              <SelectItem key={item.value} item={item}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>,
      );

      // The shadow really is there — otherwise this test proves nothing.
      expect(container.querySelectorAll("select")).not.toHaveLength(0);
      expect(findNativeSelects(container)).toHaveLength(0);
    });
  });

  describe("when the page renders a select a reader can operate", () => {
    it("counts it", () => {
      const { container } = render(
        <select name="department">
          <option value="all">All departments</option>
        </select>,
      );

      expect(findNativeSelects(container)).toHaveLength(1);
    });

    /**
     * The regression. A modal marks every element outside its content
     * `aria-hidden="true"`, so a reachable select inherits a hidden ancestor
     * through no fault of its own. It is still reachable — the reader closes
     * the dialog and operates it — so the rule must still catch it.
     */
    it("counts it even while an open dialog has marked the page aria-hidden", () => {
      const { container } = render(
        <div>
          {/* Exactly what @zag-js/aria-hidden hideOthers does to the page
              behind an open modal: aria-hidden="true" on the siblings of the
              dialog content, walking out to document.body. */}
          <div aria-hidden="true" data-aria-hidden="">
            <select name="department">
              <option value="all">All departments</option>
            </select>
          </div>
          <div role="dialog">
            <button type="button">Add department</button>
          </div>
        </div>,
      );

      expect(findNativeSelects(container)).toHaveLength(1);
    });
  });
});
