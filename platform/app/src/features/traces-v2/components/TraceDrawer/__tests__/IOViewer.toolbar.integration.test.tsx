/**
 * @vitest-environment jsdom
 *
 * The INPUT/OUTPUT panel toolbar: one format selector, the action buttons,
 * and the overflow behaviour when the row runs out of room. Overflow is
 * driven by `useOverflowVisibility`, which measures real rects — jsdom
 * reports zeros, so the tests that need a narrow toolbar stub
 * `getBoundingClientRect` for the scroller and its items.
 *
 * UX contract: specs/traces-v2/io-toolbar.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  canManage: true,
  storedComments: [] as unknown[],
  translate: vi.fn(async () => ({ translation: "translated!" })),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManage : true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock(
  "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground",
  () => ({
    useGoToSpanInPlaygroundTabUrlBuilder: () => ({
      buildUrl: () => new URL("https://app.test/prompts?span=span-7"),
    }),
  }),
);

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: undefined,
    isLoading: false,
    visibleTo: null,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useQueries: () => [
      { data: mocks.storedComments, isLoading: false, isError: false },
    ],
    useUtils: () => ({
      annotation: {
        getByTraceId: { invalidate: vi.fn() },
        getByTraceIds: { invalidate: vi.fn() },
      },
      traceEditOverlay: { getByTraceId: { invalidate: vi.fn() } },
    }),
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    translate: {
      translate: { useMutation: () => ({ mutateAsync: mocks.translate }) },
    },
  },
}));

import { IOViewer } from "../IOViewer";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-7";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Rects for the overflow measurement. When `itemRights` is set, elements
 * carrying `data-overflow-id` report the mapped right edge and the scroller
 * (the nearest element containing them) reports `containerRight`; without it
 * everything keeps jsdom's zero rects, which the hook reads as a row that is
 * not laid out and leaves alone.
 */
let itemRights: Record<string, number> | null = null;
let containerRight = 0;

const fakeRect = (right: number): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 22,
    right,
    width: right,
    height: 22,
    toJSON: () => ({}),
  }) as DOMRect;

const originalGetRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  mocks.canManage = true;
  mocks.storedComments = [];
  mocks.translate.mockClear();
  itemRights = null;
  // Reset with `itemRights`, or a suite that sets item rects without setting
  // a container edge would inherit whichever one ran before it.
  containerRight = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (!itemRights) return originalGetRect.call(this);
      const id = this.getAttribute("data-overflow-id");
      if (id && id in itemRights) return fakeRect(itemRights[id]!);
      if (this.querySelector?.("[data-overflow-id]")) {
        return fakeRect(containerRight);
      }
      return originalGetRect.call(this);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderViewer(over: Partial<React.ComponentProps<typeof IOViewer>>) {
  return render(
    <IOViewer
      label="Input"
      content='{"question": "where is my order?"}'
      mode="input"
      traceId={TRACE_ID}
      spanId={SPAN_ID}
      spanType="llm"
      {...over}
    />,
    { wrapper },
  );
}

const formatTrigger = () =>
  screen.getByRole("button", { name: "Input view format" });

describe("given an input panel with JSON content", () => {
  describe("when the user opens the format selector", () => {
    /** @scenario "One selector holds the view formats" */
    it("lists all the formats and switches on pick", async () => {
      const user = userEvent.setup();
      renderViewer({});

      expect(formatTrigger()).toHaveTextContent("Pretty");
      await user.click(formatTrigger());

      for (const name of ["Pretty", "Text", "JSON", "Markdown"]) {
        expect(
          await screen.findByRole("menuitem", { name }),
        ).toBeInTheDocument();
      }

      await user.click(screen.getByRole("menuitem", { name: "Text" }));
      expect(formatTrigger()).toHaveTextContent("Text");
    });
  });
});

describe("given a chat-shaped input rendered in the Pretty format", () => {
  const chatContent = JSON.stringify([
    { role: "user", content: "where is my order?" },
    { role: "assistant", content: "on its way" },
  ]);

  /** @scenario "The active format keeps its inline layout toggles" */
  it("keeps the layout toggles beside the selector, following the format", async () => {
    const user = userEvent.setup();
    renderViewer({ content: chatContent });

    expect(
      screen.getByRole("button", { name: "Thread view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Bubbles view" }),
    ).toBeInTheDocument();

    await user.click(formatTrigger());
    await user.click(await screen.findByRole("menuitem", { name: "Markdown" }));

    expect(
      await screen.findByRole("button", { name: "Rendered view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Source view" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thread view" }),
    ).not.toBeInTheDocument();
  });
});

describe("given a toolbar too narrow for all action buttons", () => {
  beforeEach(() => {
    // The cutoff is `containerRight - reservePx`, i.e. 174: translate and
    // comment fit, suggest and playground do not.
    containerRight = 200;
    itemRights = {
      translate: 60,
      comment: 120,
      suggest: 260,
      playground: 320,
    };
  });

  /** @scenario "Actions that do not fit collapse into the overflow menu" */
  it("moves exactly the actions that do not fit into the three-dot menu", async () => {
    const user = userEvent.setup();
    renderViewer({});

    const menuTrigger = await screen.findByRole("button", {
      name: "More actions",
    });
    await user.click(menuTrigger);

    expect(
      await screen.findByRole("menuitem", { name: "Suggest edit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Open in Playground" }),
    ).toBeInTheDocument();
    // The ones that still fit stay inline, not in the menu.
    expect(
      screen.queryByRole("menuitem", { name: "Translate" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Comment" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Copy is always the last visible control" */
  it("keeps the copy button visible after the overflow menu", async () => {
    renderViewer({});

    const menuTrigger = await screen.findByRole("button", {
      name: "More actions",
    });
    const copyButton = screen.getByRole("button", {
      name: "Copy to clipboard",
    });
    expect(copyButton).toBeInTheDocument();
    expect(
      menuTrigger.compareDocumentPosition(copyButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** @scenario "Copy is always the last visible control" */
  it("never moves the copy button into the menu", async () => {
    const user = userEvent.setup();
    renderViewer({});

    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );

    // The menu holds the two actions that overflowed and nothing else — Copy
    // is not one of the measured items, so it can never be folded in.
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["Suggest edit", "Open in Playground"]);
    expect(
      screen.getByRole("button", { name: "Copy to clipboard" }),
    ).toBeVisible();
  });

  /**
   * The trigger is measured along with the actions rather than sitting outside
   * the row: as an outside sibling its mount shrinks the row, the
   * ResizeObserver clears the hidden set, and the trigger unmounts and
   * remounts on every measurement.
   */
  /** @scenario "Actions that do not fit collapse into the overflow menu" */
  it("keeps the overflow trigger inside the measured row", async () => {
    renderViewer({});

    const menuTrigger = await screen.findByRole("button", {
      name: "More actions",
    });
    const measuredRow = document
      .querySelector("[data-overflow-id]")
      ?.closest("div")?.parentElement;

    expect(measuredRow).not.toBeNull();
    expect(measuredRow?.contains(menuTrigger)).toBe(true);
  });
});

describe("given an action that fits the row but not the trigger's slot", () => {
  beforeEach(() => {
    // Comment ends 10px before the row's right edge, inside the room held
    // back for the trigger. It has to fold in, or the trigger has nowhere to
    // render.
    containerRight = 200;
    itemRights = {
      translate: 60,
      comment: 190,
      suggest: 260,
      playground: 320,
    };
  });

  /** @scenario "Actions that do not fit collapse into the overflow menu" */
  it("folds it into the menu so the trigger keeps its room", async () => {
    const user = userEvent.setup();
    renderViewer({});

    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Comment" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Translate" }),
    ).not.toBeInTheDocument();
  });
});

describe("given a reader who cannot manage annotations", () => {
  beforeEach(() => {
    mocks.canManage = false;
  });

  describe("when the field carries no comments", () => {
    it("offers neither Comment nor Suggest edit", async () => {
      renderViewer({});

      // Translate is unconditional, so waiting on it proves the toolbar
      // rendered before asserting the other two are absent.
      expect(
        await screen.findByRole("button", { name: /Translate/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Suggest edit" })).toBeNull();
    });

    it("keeps them out of the overflow menu as well", async () => {
      const user = userEvent.setup();
      // Only translate and playground are built for this reader; the row is
      // narrow enough that playground has to fold in, so there is a menu to
      // read.
      containerRight = 200;
      itemRights = { translate: 60, playground: 320 };
      renderViewer({});

      await user.click(
        await screen.findByRole("button", { name: "More actions" }),
      );

      expect(
        (await screen.findAllByRole("menuitem")).map(
          (item) => item.textContent,
        ),
      ).toEqual(["Open in Playground"]);
    });
  });

  describe("when the field already carries a comment", () => {
    beforeEach(() => {
      // The anchor has to match the one the panel builds, or the annotation
      // indexes under a different key and the gate sees no comments.
      mocks.storedComments = [
        {
          id: "annotation-1",
          comment: "looks wrong",
          anchorKind: "field",
          anchorId: SPAN_ID,
          anchorPath: "input",
        },
      ];
    });

    it("offers the comment to read, but still no Suggest edit", async () => {
      renderViewer({});

      // The control names the count, so this also proves the stored comment
      // reached it rather than the action merely being present.
      expect(
        await screen.findByRole("button", { name: "1 comment" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Suggest edit" })).toBeNull();
    });
  });
});

describe("given the translate action collapsed into the overflow menu", () => {
  beforeEach(() => {
    containerRight = 100;
    itemRights = {
      translate: 260,
      comment: 300,
      suggest: 340,
      playground: 380,
    };
  });

  /** @scenario "An action selected from the overflow menu still works" */
  it("starts translating when Translate is picked from the menu", async () => {
    const user = userEvent.setup();
    renderViewer({});

    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Translate" }),
    );

    await waitFor(() => {
      expect(mocks.translate).toHaveBeenCalled();
    });
  });
});
