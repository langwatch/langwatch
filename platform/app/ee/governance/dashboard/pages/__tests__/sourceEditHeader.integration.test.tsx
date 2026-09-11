// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * What the edit drawer's header says, and what sits behind it.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Spec: specs/governance/anthropic-source-form-controls.feature
 *
 * Two changes with one cause. The title read "Edit source" for every source
 * type, so an admin who reached the drawer from a row action, a detail page or
 * a restored browser tab had nothing in the header telling them which of their
 * sources they were about to change. And the notes explaining why a field is
 * locked were body paragraphs sitting above the fields, which put three
 * sentences of adapter reasoning between the admin and the form every time
 * they opened a source that had already pulled.
 *
 * The create composer had already solved both — provider glyph, provider name,
 * and the long explanation behind a (i) beside the heading. This is the edit
 * drawer being given the same header rather than a second design for it.
 *
 * Drives the real `SourceEditDrawer` for the same reason
 * `sourceEditDestination.integration.test.tsx` does: a harness that rebuilt
 * the header would only prove the copy agrees with itself.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceEditDrawer } from "../inventory";

/** Same minimal stub as the destination test: OTTL is not what this covers. */
vi.mock("~/utils/api", () => ({
  api: {
    ingestionSources: {
      ottlStarter: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      validateOttl: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          data: undefined,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const ORG_ID = "org_acme";

const DESTINATION_CTX = {
  organizationId: ORG_ID,
  organizationName: "Acme",
  availableTeams: [],
  availableProjects: [],
};

type DrawerSource = Parameters<typeof SourceEditDrawer>[0]["source"];

/**
 * An Anthropic source in a given state.
 *
 * `hasPollerCursor` is what decides every lock on this form — the row's own
 * answer to "has this ever pulled", rather than an inference from `status`,
 * which is wrong in both directions.
 */
const anthropicSource = ({
  report,
  hasPulled,
}: {
  report: string;
  hasPulled: boolean;
}) =>
  ({
    id: "src_anthropic",
    name: "Anthropic org",
    description: "",
    sourceType: "anthropic_admin",
    parserConfig: {
      report,
      startingAt: "2026-03-15T00:00:00.000Z",
    },
    pullSchedule: "0 * * * *",
    hasPollerCursor: hasPulled,
    traceProjectId: null,
    traceProjectArchived: false,
  }) as unknown as DrawerSource;

/** A row written by a newer deploy than the one serving this page. */
const sourceOfAnUnknownType = {
  id: "src_future",
  name: "Something new",
  description: "",
  sourceType: "quantum_ledger",
  parserConfig: {},
  traceProjectId: null,
  traceProjectArchived: false,
} as unknown as DrawerSource;

const renderDrawer = (source: DrawerSource) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SourceEditDrawer
        organizationId={ORG_ID}
        destinationCtx={DESTINATION_CTX}
        source={source}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
      />
    </ChakraProvider>,
  );

/**
 * Opens the marker and returns what it holds.
 *
 * By the trigger's own `aria-controls` rather than by role: the drawer around
 * it is a dialog too, so asking for one by role finds both and cannot say
 * which of them the note is in — which is the whole claim being made here.
 */
const openNotes = async (): Promise<string> => {
  const user = userEvent.setup();
  const trigger = screen.getByTestId("edit-source-notes");
  await user.click(trigger);

  const contentId = trigger.getAttribute("aria-controls");
  if (!contentId) throw new Error("the marker controls no popover");
  return (await waitFor(() => {
    const content = document.getElementById(contentId);
    // Chakra mounts the content closed, already holding its text, so waiting
    // for text alone is satisfied before the click has done anything. The
    // open state is the part that actually has to settle.
    if (content?.getAttribute("data-state") !== "open") {
      throw new Error("the popover has not opened");
    }
    if (!content.textContent) throw new Error("the popover is still empty");
    return content.textContent;
  })) as string;
};

describe("given the edit drawer's title", () => {
  /** @scenario "The edit title names the provider and shows its logo" */
  it("names the provider it is editing", () => {
    renderDrawer(anthropicSource({ report: "cost", hasPulled: false }));

    expect(
      screen.getByRole("heading", { name: "Edit Anthropic Admin API" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Edit source" })).toBeNull();
  });

  /** @scenario "The edit title names the provider and shows its logo" */
  it("shows the provider's glyph beside the name", () => {
    renderDrawer(anthropicSource({ report: "cost", hasPulled: false }));

    // The same mark the Add source menu and the create composer show for this
    // type. A header that names the provider in words alone is a different
    // header from the one an admin just came through.
    expect(screen.getByTestId("source-type-icon")).toBeTruthy();
  });

  /** @scenario "An unrecognised source type still gets a title" */
  it("falls back to a plain title for a type it has no entry for", () => {
    // Every lookup on this drawer is keyed by `SourceType` and simply misses
    // for a row written by a newer deploy. A missed lookup must leave a title
    // rather than "Edit undefined" or a blank header.
    renderDrawer(sourceOfAnUnknownType);

    expect(screen.getByRole("heading", { name: "Edit source" })).toBeTruthy();
  });
});

describe("given a source with settings its adapter can no longer change", () => {
  /** @scenario "A pulled usage source carries the two notes that apply to it" */
  it("puts the usage source's two notes behind the one marker", async () => {
    renderDrawer(anthropicSource({ report: "usage", hasPulled: true }));
    const notes = await openNotes();

    // The usage cursor never rewinds, so both of this source's settings are
    // fixed once it has pulled.
    expect(notes).toMatch(/report/i);
    expect(notes).toMatch(/start/i);
    // Restating cost history is a cost-source sentence. Shown here it would
    // describe a repair this source cannot perform.
    expect(notes).not.toMatch(/restate/i);
  });

  /** @scenario "A pulled cost source carries a different two" */
  it("puts the cost source's different two behind the same marker", async () => {
    renderDrawer(anthropicSource({ report: "cost", hasPulled: true }));
    const notes = await openNotes();

    expect(notes).toMatch(/report/i);
    // The cost cursor binds `startingAt` into its own identity, so moving the
    // start is the deliberate repair lever rather than a setting to lock. The
    // three notes never all apply at once: a fixed start and a start worth
    // moving are the two halves of one condition.
    expect(notes).toMatch(/restate|re-read/i);
    expect(notes).not.toMatch(/start date is fixed/i);
  });

  /** @scenario "A source with nothing locked shows no marker at all" */
  it("shows no marker on a source that has never pulled", () => {
    // Nothing is locked before a cursor exists, so every note would be
    // inapplicable — and a marker opening onto an empty popover is worse than
    // no marker, because it invites a click that answers nothing.
    renderDrawer(anthropicSource({ report: "cost", hasPulled: false }));

    expect(screen.queryByTestId("edit-source-notes")).toBeNull();
  });

  /** @scenario "The locked-field notes move behind an information marker" */
  it("keeps the notes out of the body, where they used to sit", () => {
    renderDrawer(anthropicSource({ report: "usage", hasPulled: true }));

    // Chakra keeps popover content mounted and hidden while closed, so only a
    // visibility matcher tells "behind the marker" from "in the body".
    expect(screen.getByTestId("edit-source-notes")).toBeVisible();
    expect(
      screen.getByText(/is fixed once a source has pulled/i),
    ).not.toBeVisible();
  });

  /** @scenario "A locked report is still readable and still reachable" */
  it("leaves a locked report readable and in the tab order", () => {
    renderDrawer(anthropicSource({ report: "cost", hasPulled: true }));

    const report = screen.getByLabelText("Use Anthropic's reported cost");

    // readOnly, never disabled: a disabled control drops out of the tab order,
    // where a keyboard or screen-reader user cannot read what it holds. And
    // what it holds has to be the report's own name — "Off" is the position of
    // a control this admin can no longer see.
    expect(report).toHaveProperty("readOnly", true);
    expect((report as HTMLInputElement).disabled).toBe(false);
    expect((report as HTMLInputElement).value).toBe("Cost report");
  });
});
