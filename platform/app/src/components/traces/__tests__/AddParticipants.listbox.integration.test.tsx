/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 *
 * #6716: the "Send to" listbox this renders sat unclickable when used from
 * the automation composer's annotation-queue provider, because the
 * secondary (Configuration) drawer stacks on top of the main composer
 * drawer and `portalled={false}` kept the floating listbox as a normal DOM
 * descendant instead of routing it through the shared z-index-safe portal
 * (`components/ui/select.tsx`'s `useOverlayZIndex`) every other Select in
 * the app uses. jsdom cannot reproduce real stacking-context pointer
 * capture, so this guards the structural half of the fix that IS
 * observable without a browser: the listbox portals to `document.body`
 * (outside wherever it's mounted, so a later overlay's own stacking
 * context can never sit on top of it) and there is exactly one listbox, not
 * a second inert copy left behind.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddParticipants } from "../AddParticipants";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "project-1" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getQueues: {
        useQuery: () => ({
          data: [{ id: "queue-1", name: "Review queue" }],
        }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: { members: [] },
        }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given the annotation-queue 'Send to' selector", () => {
  afterEach(() => cleanup());

  describe("when it is stacked inside another overlay and opened", () => {
    /** @scenario Selecting a queue from the automation composer's secondary drawer */
    it("portals the listbox outside the local render tree and picking an option selects it", async () => {
      const user = userEvent.setup();
      const setAnnotators = vi.fn();
      const { container } = render(
        // A wrapping div stands in for the secondary drawer's own DOM
        // subtree — the failure mode was the listbox staying trapped inside
        // whatever locally-stacked container it rendered in.
        <div data-testid="stacked-drawer">
          <AddParticipants
            annotators={[]}
            setAnnotators={setAnnotators}
            isTrigger={true}
          />
        </div>,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Add Participants"));

      // Chakra's native `<select multiple>` fallback (for form semantics)
      // also carries an implicit `listbox` role, so scope to the one Ark UI
      // actually renders the floating options into (`data-part="content"`).
      const listboxes = screen
        .getAllByRole("listbox")
        .filter((el) => el.getAttribute("data-part") === "content");
      expect(listboxes).toHaveLength(1);
      const listbox = listboxes[0]!;
      const option = within(listbox).getByRole("option", {
        name: /Review queue/,
      });
      // Portalled: the listbox is found via the document, not inside the
      // local subtree — this is what keeps a later-stacked overlay from
      // ever painting over it or intercepting its clicks.
      expect(
        container
          .querySelector('[data-testid="stacked-drawer"]')!
          .contains(listbox),
      ).toBe(false);

      await user.click(option);

      expect(setAnnotators).toHaveBeenCalledWith([
        { id: "queue-queue-1", name: "Review queue" },
      ]);
    });
  });
});
