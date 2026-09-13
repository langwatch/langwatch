/**
 * @vitest-environment jsdom
 *
 * The targeting-rules dialog as an operator meets it: what the field beside a
 * scope asks for, where an added rule lands, and whether a rule can be
 * grabbed at all.
 *
 * Placement and reordering have their own unit coverage in ruleEditing; what
 * these add is that the dialog is actually wired to it — a correct helper
 * that the "Add rule" button never calls fixes nothing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagRules } from "~/server/featureFlag";
import { FeatureFlagRulesDialog } from "../FeatureFlagRulesDialog";

const mutateAsync = vi.fn();

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ ops: { listFeatureFlags: { invalidate: vi.fn() } } }),
    ops: {
      setFeatureFlagRules: {
        useMutation: () => ({ mutateAsync, isPending: false }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
});

function renderDialog(initialRules: FeatureFlagRules) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FeatureFlagRulesDialog
        open
        onOpenChange={vi.fn()}
        flagKey="release_ui_comparison_leaderboard_enabled"
        initialRules={initialRules}
      />
    </ChakraProvider>,
  );
}

/** The scope field labels, top to bottom — the rule order an operator sees. */
function ruleFieldLabels(): string[] {
  return screen
    .getAllByText(
      /Organization id|Project id|Applies to every context|Organization created on or after/,
    )
    .map((element) => element.textContent ?? "");
}

describe("given rules that end with a rule applying to everyone", () => {
  describe("when the operator adds a rule", () => {
    /** @scenario "a new rule lands above a trailing everyone rule" */
    it("puts the new rule above it, where it can still fire", async () => {
      const user = userEvent.setup();
      renderDialog([
        { match: { organizationId: "organization_a" }, enabled: true },
        { match: {}, enabled: false },
      ]);

      expect(ruleFieldLabels()).toEqual([
        "Organization id",
        "Applies to every context",
      ]);

      await user.click(screen.getByRole("button", { name: /add rule/i }));

      expect(ruleFieldLabels()).toEqual([
        "Organization id",
        "Organization id",
        "Applies to every context",
      ]);
    });
  });
});

describe("given rules that do not end with a rule applying to everyone", () => {
  describe("when the operator adds a rule", () => {
    /** @scenario "a new rule is appended when the list does not end in everyone" */
    it("appends it", async () => {
      const user = userEvent.setup();
      renderDialog([
        { match: {}, enabled: false },
        { match: { projectId: "project_a" }, enabled: true },
      ]);

      await user.click(screen.getByRole("button", { name: /add rule/i }));

      expect(ruleFieldLabels()).toEqual([
        "Applies to every context",
        "Project id",
        "Organization id",
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

    expect(
      screen.getAllByRole("button", { name: "Reorder rule" }),
    ).toHaveLength(3);
  });
});

describe("given a stored rule naming an organization creation date", () => {
  /** @scenario "a saved New users rule reopens as a New users rule" */
  it("reopens as a New users rule with the date in a date field", () => {
    renderDialog([
      { match: { organizationCreatedAfter: "2026-06-01" }, enabled: true },
    ]);

    expect(
      screen.getByText("New users", { selector: "[data-part='value-text']" }),
    ).toBeInTheDocument();
    const field = screen.getByLabelText("Organization created on or after");
    expect(field).toHaveAttribute("type", "date");
    expect(field).toHaveValue("2026-06-01");
  });
});

describe("given an operator picks the New users scope for a rule", () => {
  /** @scenario "picking New users asks for a date instead of an id" */
  it("swaps the organization id field for a date", async () => {
    const user = userEvent.setup();
    renderDialog([
      { match: { organizationId: "organization_a" }, enabled: true },
    ]);

    expect(screen.getByLabelText("Organization id")).toHaveAttribute(
      "type",
      "text",
    );

    await user.click(screen.getByRole("combobox", { name: /scope/i }));
    // The picker mirrors each option into a hidden native <select>, so the
    // items have to be told apart by their part rather than by their role.
    const newUsersOption = screen
      .getAllByRole("option", { name: /New users/, hidden: true })
      .find((element) => element.getAttribute("data-part") === "item");
    await user.click(newUsersOption!);

    const field = screen.getByLabelText("Organization created on or after");
    expect(field).toHaveAttribute("type", "date");
    // The organization id must not survive the scope change: as a date it
    // parses to nothing, and the rule would match nobody while reading live.
    expect(field).toHaveValue("");
  });
});

/**
 * jsdom lays nothing out, so every rect is zero and dnd-kit cannot tell which
 * row a keypress moves toward. Stacking siblings 60px apart is the smallest
 * geometry that makes "the row below" a real answer.
 */
function stubVerticalLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
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
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** One keystroke, delivered where dnd-kit's keyboard sensor listens for it. */
function press({
  element,
  code,
}: {
  element: HTMLElement;
  code: string;
}): void {
  fireEvent.keyDown(element, { code, key: code === "Space" ? " " : code });
}

/**
 * What dnd-kit is telling screen readers right now.
 *
 * The sensor measures its droppable rects off the main flow, so a keypress
 * sent before that lands finds no geometry and moves nothing. Waiting on the
 * announcement waits on the sensor's own account of what it did, rather than
 * on a frame count that happens to be enough on one machine.
 */
function announcement(): string {
  return document.querySelector("[aria-live]")?.textContent ?? "";
}

describe("given a flag with more than one targeting rule", () => {
  describe("when the operator moves a rule using only the keyboard", () => {
    /** @scenario "an operator reorders rules from the keyboard" */
    it("changes the order, so rule priority is not a pointer-only decision", async () => {
      const restoreLayout = stubVerticalLayout();
      try {
        renderDialog([
          { match: { organizationId: "organization_a" }, enabled: true },
          { match: { projectId: "project_b" }, enabled: true },
        ]);

        const [firstGrip] = screen.getAllByRole("button", {
          name: "Reorder rule",
        });
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
        await waitFor(() =>
          expect(ruleFieldLabels()).toEqual(["Project id", "Organization id"]),
        );
      } finally {
        restoreLayout();
      }
    });
  });
});
