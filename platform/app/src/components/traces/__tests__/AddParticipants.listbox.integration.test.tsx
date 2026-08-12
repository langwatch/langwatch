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
 * the app uses — a real, click-blocking, visual-stacking-context defect in
 * a browser.
 *
 * Two tests here, at two different confidence levels:
 *
 *  - "portals the listbox outside the local render tree" is a genuine
 *    regression guard: it asserts the listbox mounts outside whatever
 *    container it's rendered in (proven by temporarily reverting the fix
 *    locally and re-running — it fails against `portalled={false}` and
 *    passes against the fix).
 *  - "does not dismiss the parent overlay" nests the component inside a
 *    real, dismissable `Dialog.Root` and clicks a listbox option, checking
 *    that selection fires and the dialog isn't dismissed as an "outside"
 *    interaction. This is real behavioural coverage of the fixed code
 *    working correctly nested inside another overlay — but it does NOT, on
 *    its own, discriminate the fix from the bug: verified empirically (both
 *    with this `Dialog.Root` nesting and with the production `Drawer.Root`
 *    nesting `ConfigurationSecondaryDrawer` actually uses) that jsdom
 *    delivers `userEvent.click` directly to the element under test
 *    regardless of DOM position or any real stacking context, because it
 *    has no elementFromPoint-based hit-testing — the actual "click lands on
 *    whatever visually covers it" defect is real-browser-only and outside
 *    what a jsdom test can exercise. Kept as supplementary coverage, not as
 *    the regression guard.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "~/components/ui/dialog";
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
    it("portals the listbox outside the local render tree", async () => {
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

  describe("when nested inside a real dismissable overlay and an option is picked", () => {
    /** @scenario Selecting a queue from the automation composer's secondary drawer */
    it("selects the option and does not dismiss the parent overlay as an outside click", async () => {
      function StackedOverlayHarness({
        onSelect,
      }: {
        onSelect: (a: { id: string; name: string }[]) => void;
      }) {
        const [open, setOpen] = useState(true);
        return (
          <Dialog.Root
            open={open}
            onOpenChange={(details) => setOpen(details.open)}
          >
            <Dialog.Content>
              <Dialog.Body>
                <AddParticipants
                  annotators={[]}
                  setAnnotators={onSelect}
                  isTrigger={true}
                />
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Root>
        );
      }

      const user = userEvent.setup();
      const setAnnotators = vi.fn();
      render(<StackedOverlayHarness onSelect={setAnnotators} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.click(screen.getByText("Add Participants"));

      // Query by text, not role: nesting a Select inside an open modal
      // Dialog makes Ark's "hide inert siblings from assistive tech" pass
      // mark the listbox's own descendants `aria-hidden` (confirmed present
      // regardless of the portal fix — an unrelated jsdom/Dialog+Select
      // interaction, not the bug under test), and `aria-hidden` does not
      // stop a real click from being dispatched or handled.
      const option = screen
        .getAllByText("Review queue")
        .find((el) => el.closest('[data-scope="select"][data-part="item"]'))!;
      expect(option).toBeTruthy();

      await user.click(option);

      expect(setAnnotators).toHaveBeenCalledWith([
        { id: "queue-queue-1", name: "Review queue" },
      ]);
      // The click landed inside the Select's own listbox — it must not read
      // as an outside interaction that dismisses the parent overlay.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
