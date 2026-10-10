import { Dialog } from "@langwatch/design-system/dialog";
/**
 * @vitest-environment jsdom
 * #6716: the "Send to" listbox must portal out of whatever stacked drawer it
 * renders in. jsdom has no hit-testing, so only the portal test guards the
 * regression; the dialog test covers picking an option inside an overlay.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddParticipants } from "../add-participants.tsx";

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "project-1" },
  }),
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    annotation: {
      getQueues: {
        useQuery: () => ({ data: [{ id: "queue-1", name: "Review queue" }] }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: [] } }),
      },
    },
  },
}));

function StackedOverlayHarness({
  onSelect,
}: {
  onSelect: (annotators: { id: string; name: string }[]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)}>
      <Dialog.Content>
        <Dialog.Body>
          <AddParticipants annotators={[]} setAnnotators={onSelect} isTrigger={true} />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

describe("given the annotation-queue 'Send to' selector", () => {
  afterEach(() => cleanup());

  describe("when it is stacked inside another overlay and opened", () => {
    it("portals the listbox outside the local render tree", async () => {
      const user = userEvent.setup();
      const setAnnotators = vi.fn();
      renderWithDesignSystem(
        <div data-testid="stacked-drawer">
          <AddParticipants annotators={[]} setAnnotators={setAnnotators} isTrigger={true} />
        </div>,
      );

      await user.click(screen.getByText("Add Participants"));

      // The native `<select multiple>` fallback is a listbox too; take Ark's content part.
      const listboxes = screen
        .getAllByRole("listbox")
        .filter((el) => el.getAttribute("data-part") === "content");
      expect(listboxes).toHaveLength(1);
      const listbox = listboxes[0]!;
      const option = within(listbox).getByRole("option", { name: /Review queue/ });
      expect(screen.getByTestId("stacked-drawer").contains(listbox)).toBe(false);

      await user.click(option);

      expect(setAnnotators).toHaveBeenCalledWith([{ id: "queue-queue-1", name: "Review queue" }]);
    });
  });

  describe("when nested inside a real dismissable overlay and an option is picked", () => {
    /** @scenario Selecting a queue from the automation composer's secondary drawer */
    it("selects the option and does not dismiss the parent overlay as an outside click", async () => {
      const user = userEvent.setup();
      const setAnnotators = vi.fn();
      renderWithDesignSystem(<StackedOverlayHarness onSelect={setAnnotators} />);

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.click(screen.getByText("Add Participants"));

      // By text, not role: the modal marks the listbox's descendants aria-hidden in jsdom.
      const option = screen
        .getAllByText("Review queue")
        .find((el) => el.closest('[data-scope="select"][data-part="item"]'))!;
      expect(option).toBeTruthy();

      // The modal sets body pointer-events none before the listbox layer restores its own.
      await waitFor(() => {
        expect(getComputedStyle(option).pointerEvents).not.toBe("none");
      });

      await user.click(option);

      expect(setAnnotators).toHaveBeenCalledWith([{ id: "queue-queue-1", name: "Review queue" }]);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
