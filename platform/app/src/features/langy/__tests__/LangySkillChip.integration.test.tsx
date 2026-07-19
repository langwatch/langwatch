/**
 * @vitest-environment jsdom
 *
 * The skill chip is compact by default — just the verb — and reveals its target
 * slot and remove control only when expanded, so it never reads as a full card.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/shared/langy/langySkills", () => ({
  findSkill: () => ({ summary: "Open pull requests on GitHub" }),
}));

import { LangySkillChipView } from "../components/LangySkillChip";
import type { LangyContextChip, LangySkillChip } from "../stores/langyStore";

const chip: LangySkillChip = {
  id: "github",
  label: "GitHub",
  targetChipId: null,
};
const contextChips: LangyContextChip[] = [
  { id: "trace:abc", kind: "trace", label: "Trace abc123" },
];

function renderChip() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangySkillChipView
        chip={chip}
        contextChips={contextChips}
        onRemove={() => {}}
        onRetarget={() => {}}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("given a Langy skill chip", () => {
  describe("when it first renders", () => {
    it("is compact — the label shows but the remove control is hidden", () => {
      renderChip();
      expect(screen.getByText("GitHub")).toBeTruthy();
      expect(screen.queryByLabelText("Remove GitHub skill")).toBeNull();
      expect(
        screen.getByLabelText("GitHub skill. Expand options"),
      ).toBeTruthy();
    });
  });

  describe("when it is expanded", () => {
    it("reveals the target slot and the remove control", () => {
      renderChip();
      fireEvent.click(screen.getByLabelText("GitHub skill. Expand options"));
      expect(screen.getByLabelText("Remove GitHub skill")).toBeTruthy();
      expect(screen.getByLabelText("Aim GitHub at something")).toBeTruthy();
      expect(screen.getByLabelText("Collapse GitHub options")).toBeTruthy();
    });
  });
});
