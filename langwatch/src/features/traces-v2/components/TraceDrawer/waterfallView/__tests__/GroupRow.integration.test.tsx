/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRow } from "../GroupRow";
import type { SiblingGroup } from "../types";

afterEach(cleanup);

function group(over: Partial<SiblingGroup> = {}): SiblingGroup {
  return {
    kind: "group",
    name: "Bash",
    type: "tool",
    count: 5,
    spans: [],
    avgDuration: 10,
    minDuration: 5,
    maxDuration: 20,
    errorCount: 0,
    minStart: 0,
    maxEnd: 100,
    depth: 0,
    parentSpanId: null,
    ...over,
  };
}

const baseProps = {
  groupKey: "root::Bash",
  isExpanded: false,
  onToggle: vi.fn(),
};

function renderGroupRow(over: Partial<SiblingGroup> = {}) {
  const { container } = render(
    <ChakraProvider value={defaultSystem}>
      <GroupRow group={group(over)} {...baseProps} />
    </ChakraProvider>,
  );
  // The dashed left border carries the accent color — its class name changes
  // whenever the resolved color token changes (Chakra emits one atomic class
  // per distinct style value), so a class diff proves the row actually
  // reacted to `isSkill`, not just that the underlying predicate is true.
  return container.firstElementChild!.className;
}

describe("GroupRow", () => {
  describe("given a folded group of Skill tool spans", () => {
    it("renders with a different accent than a same-type non-skill group", () => {
      // Both share type "tool" — without the isSkill override, getSpanPalette
      // would resolve both to the identical "green" tool color, so a class
      // match here would mean the fold path lost the skill accent.
      const skillClass = renderGroupRow({ name: "Skill" });
      cleanup();
      const toolClass = renderGroupRow({ name: "Bash" });

      expect(skillClass).not.toBe(toolClass);
    });
  });
});
