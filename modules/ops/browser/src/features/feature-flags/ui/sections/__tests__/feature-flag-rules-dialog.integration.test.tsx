/**
 * Targeting-rules dialog as operator meets it: placement, reordering, adding
 * rules (with dialog wiring to rule-editing).
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/ops-api.ts", async () => ({
  api: (await import("./support/feature-flag-target-directory.fixture.ts")).directoryApi(),
}));

import { FeatureFlagRulesDialog } from "../feature-flag-rules-dialog.tsx";
import { directoryState } from "./support/feature-flag-target-directory.fixture.ts";

// The dialog marks the rest of the document inert, which user-event reads as
// "nothing here is clickable"; the operator's pointer is not so fussy.
const clicks = () => userEvent.setup({ pointerEventsCheck: 0 });

afterEach(() => {
  cleanup();
});

function renderDialog(
  initialRules: FeatureFlagRules,
  onSave: (input: { key: string; rules: FeatureFlagRules }) => Promise<void> = vi
    .fn()
    .mockResolvedValue(void 0),
) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <FeatureFlagRulesDialog
        open
        onOpenChange={vi.fn()}
        flagKey="release_ui_comparison_leaderboard_enabled"
        initialRules={initialRules}
        onSave={onSave}
      />
    </DesignSystemProvider>,
  );
}

const FIELD_LABELS = [
  "Organization",
  "Projects",
  "Users",
  "Applies to every context",
  "Organization created on or after",
];

/** The scope field labels, top to bottom — the rule order an operator sees. */
function ruleFieldLabels(): string[] {
  return screen
    .getAllByText(
      (text, element) => element?.tagName === "LABEL" && FIELD_LABELS.includes(text.trim()),
    )
    .map((element) => element.textContent?.trim() ?? "");
}

describe("given rules that end with a rule applying to everyone", () => {
  describe("when the operator adds a rule", () => {
    it("puts the new rule above it, where it can still fire", async () => {
      const user = clicks();
      renderDialog([
        { match: { organizationId: "organization_a" }, enabled: true },
        { match: {}, enabled: false },
      ]);

      expect(ruleFieldLabels()).toEqual(["Organization", "Applies to every context"]);

      await user.click(screen.getByRole("button", { name: /add rule/i }));

      expect(ruleFieldLabels()).toEqual([
        "Organization",
        "Organization",
        "Applies to every context",
      ]);
    });
  });
});

describe("given a flag with more than one targeting rule", () => {
  /** @scenario "an operator reorders rules by dragging them" */
  it("gives every rule a handle to drag it by", () => {
    renderDialog([
      { match: { organizationId: "organization_a" }, enabled: true },
      { match: { projectId: "project_b" }, enabled: true },
      { match: {}, enabled: false },
    ]);

    expect(screen.getAllByRole("button", { name: "Reorder rule" })).toHaveLength(3);
  });
});

describe("given a stored rule naming an organization creation date", () => {
  /** @scenario "a saved New users rule reopens as a New users rule" */
  it("reopens as a New users rule with the date in a date field", () => {
    renderDialog([{ match: { organizationCreatedAfter: "2026-06-01" }, enabled: true }]);

    expect(screen.getByText("New users", { selector: "[data-part='value-text']" })).toBeTruthy();
    const field = screen.getByLabelText("Organization created on or after");
    expect(field.getAttribute("type")).toBe("date");
    expect((field as HTMLInputElement).value).toBe("2026-06-01");
  });
});

describe("given an operator picks the New users scope for a rule", () => {
  /** @scenario "picking New users asks for a date instead of an id" */
  it("swaps the organization id field for a date", async () => {
    const user = userEvent.setup();
    renderDialog([{ match: { organizationId: "organization_a" }, enabled: true }]);

    expect(screen.getByLabelText("Search organizations")).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: /scope/i }));
    // The picker mirrors each option into a hidden native <select>, so the
    // items have to be told apart by their part rather than by their role.
    const newUsersOption = screen
      .getAllByRole("option", { name: /New users/, hidden: true })
      .find((element) => element.getAttribute("data-part") === "item");
    await user.click(newUsersOption!);

    const field = screen.getByLabelText("Organization created on or after");
    expect(field.getAttribute("type")).toBe("date");
    // The organization id must not survive the scope change: as a date it
    // parses to nothing, and the rule would match nobody while reading live.
    expect((field as HTMLInputElement).value).toBe("");
  });
});

/**
 * jsdom lays nothing out, so every rect is zero and dnd-kit cannot tell which
 * row a keypress moves toward. Stacking siblings 60px apart is the smallest
 * geometry that makes "the row below" a real answer.
 */
function stubVerticalLayout(): () => void {
  const layout = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ): DOMRect {
    const siblings = this.parentElement?.children;
    const index = siblings ? Array.prototype.indexOf.call(siblings, this) : 0;
    const top = index * 60;
    return {
      x: 0,
      y: top,
      top,
      bottom: top + 50,
      left: 0,
      right: 400,
      width: 400,
      height: 50,
      toJSON: () => ({}),
    } as DOMRect;
  });
  return () => {
    layout.mockRestore();
  };
}

/** One keystroke, delivered where dnd-kit's keyboard sensor listens for it. */
function press({ element, code }: { element: HTMLElement; code: string }): void {
  fireEvent.keyDown(element, { code, key: code === "Space" ? " " : code });
}

/**
 * What dnd-kit is telling screen readers right now. The sensor measures
 * its droppable rects off the main flow, so a keypress sent too early
 * finds no geometry — waiting on this waits on the sensor's own account.
 */
function announcement(): string {
  return document.querySelector("[id^='DndLiveRegion']")?.textContent ?? "";
}

describe("given a flag whose rules an operator wants in a different order", () => {
  describe("when the operator moves a rule using only the keyboard", () => {
    /** @scenario "an operator reorders rules from the keyboard" */
    it("changes the order, so rule priority is not a pointer-only decision", async () => {
      const restoreLayout = stubVerticalLayout();
      try {
        renderDialog([
          { match: { organizationId: "organization_a" }, enabled: true },
          { match: { projectId: "project_b" }, enabled: true },
        ]);

        const [firstGrip] = screen.getAllByRole("button", { name: "Reorder rule" });
        if (!firstGrip) throw new Error("no reorder handle to press");
        // Keys are dispatched at the handle rather than typed at whatever
        // holds focus: the dialog's focus trap moves focus around between
        // tests, and what is under test is the sensor, not the trap.
        press({ element: firstGrip, code: "Space" });
        await waitFor(() => expect(announcement()).not.toBe(""));
        const pickedUp = announcement();

        press({ element: firstGrip, code: "ArrowDown" });
        await waitFor(() => expect(announcement()).not.toBe(pickedUp));

        press({ element: firstGrip, code: "Space" });
        await waitFor(() => expect(ruleFieldLabels()).toEqual(["Projects", "Organization"]));
      } finally {
        restoreLayout();
      }
    });
  });
});

/** The picked targets the dialog shows, as their visible text. */
function chips(): string[] {
  return screen
    .queryAllByTestId("feature-flag-target-chip")
    .map((element) => element.textContent ?? "");
}

describe("given an operator searching for the organization a rule targets", () => {
  /** @scenario "picking a search result fills the rule with its id" */
  it("tells the two same-named organizations apart and saves the picked id", async () => {
    const user = clicks();
    const onSave = vi.fn().mockResolvedValue(void 0);
    renderDialog([], onSave);

    await user.type(screen.getByLabelText("Search organizations"), "acme");
    const results = await screen.findAllByRole("button", { name: /Acme Labs/ });
    expect(results).toHaveLength(2);
    expect(results[0]?.textContent).toMatch(/acme-labs.*Growth.*12 members.*owner@acme\.test/);
    expect(results[1]?.textContent).toMatch(/acme-labs-2.*Free.*1 member.*trial@acme\.test/);

    await user.click(results[1]!);
    expect(chips()).toEqual([expect.stringMatching(/Acme Labs.*acme-labs-2.*Free/)]);

    await user.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        key: "release_ui_comparison_leaderboard_enabled",
        rules: [{ match: { organizationId: "organization_labs_new" }, enabled: true }],
      }),
    );
  });
});

describe("given a project rule an operator fills by searching", () => {
  /** @scenario "a project rule and a user rule take several picked targets" */
  it("holds several projects as chips with their organization, and drops a removed one", async () => {
    const user = clicks();
    const onSave = vi.fn().mockResolvedValue(void 0);
    renderDialog([{ match: { projectId: "project_checkout" }, enabled: true }], onSave);

    expect(chips()).toEqual([expect.stringMatching(/Checkout bot.*In Acme Labs \(acme-labs\)/)]);
    await user.type(screen.getByLabelText("Search projects"), "support");
    await user.click(await screen.findByRole("button", { name: /Support bot/ }));
    expect(chips()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Remove Checkout bot" }));
    await user.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        key: "release_ui_comparison_leaderboard_enabled",
        rules: [{ match: { projectId: "project_support" }, enabled: true }],
      }),
    );
  });

  it("shows a user rule's user by address with their organizations", () => {
    renderDialog([{ match: { userId: ["user_dana"] }, enabled: true }]);

    expect(chips()).toEqual([expect.stringMatching(/dana@acme\.test.*Dana.*Acme Labs/)]);
  });
});

describe("given stored rules that hold raw ids", () => {
  /** @scenario "an existing rule that holds raw ids shows their names" */
  it("shows the organization by name and slug", () => {
    renderDialog([{ match: { organizationId: "organization_labs_old" }, enabled: true }]);

    expect(chips()).toEqual([expect.stringMatching(/Acme Labs.*acme-labs.*Growth/)]);
  });

  /** @scenario "an id the directory does not know still shows and can be removed" */
  it("marks an unknown id as not found and lets the operator remove it", async () => {
    const user = clicks();
    renderDialog([{ match: { organizationId: "organization_gone" }, enabled: true }]);

    expect(chips()).toEqual([expect.stringMatching(/not found/)]);
    await user.click(screen.getByRole("button", { name: "Remove organization_gone" }));
    expect(chips()).toEqual([]);
  });

  describe("when looking up the stored ids fails", () => {
    afterEach(() => {
      directoryState.failing = false;
    });

    /** @scenario "a failed lookup does not call stored targets unknown" */
    it("offers a retry instead of marking the ids not found", () => {
      directoryState.failing = true;
      renderDialog([{ match: { organizationId: "organization_labs_old" }, enabled: true }]);

      expect(chips()).toEqual([expect.stringMatching(/Couldn't load its details/)]);
      expect(chips()[0]).not.toMatch(/not found/);
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
  });
});
