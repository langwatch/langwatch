/**
 * @vitest-environment jsdom
 *
 * Integration tests for the conversation pane:
 * - Variable values persistence (set at the message box, kept per tab)
 * - Layout mode switching (horizontal/vertical)
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts/types";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptConversationSection } from "../PromptConversationSection";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const TEST_PROJECT_ID = "test-project";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

/**
 * Helper to create a minimal TabData object for testing
 */
const createTabData = (overrides?: Partial<TabData>): TabData => ({
  chat: {
    initialMessagesFromSpanData: [],
  },
  form: {
    currentValues: {},
  },
  meta: {
    title: null,
    versionNumber: undefined,
    scope: undefined,
  },
  variableValues: {},
  ...overrides,
});

// Mock TabIdContext. tabIdRef lets a test point the component at a real store
// tab id (defaults to a fixed value for tests that don't touch the store).
const { tabIdRef } = vi.hoisted(() => ({
  tabIdRef: { current: "test-tab-id" },
}));
vi.mock("../../ui/TabContext", () => ({
  useTabId: () => tabIdRef.current,
}));

// The chat mounts the shared conversation renderer, which reaches tRPC for each
// turn's trace. This suite is about the pane around it — but the message box is
// where variable values are set, so the stub keeps that one seam real.
vi.mock("../../../chat/PromptPlaygroundChat", () => ({
  PromptPlaygroundChat: ({
    composerVariables,
    onVariableValueChange,
  }: {
    composerVariables?: Array<{ identifier: string; value: string }>;
    onVariableValueChange?: (identifier: string, value: string) => void;
  }) => (
    <div data-testid="playground-chat">
      {(composerVariables ?? []).map((variable) => (
        <input
          key={variable.identifier}
          aria-label={`Set ${variable.identifier}`}
          value={variable.value}
          onChange={(event) =>
            onVariableValueChange?.(variable.identifier, event.target.value)
          }
        />
      ))}
    </div>
  ),
}));

/**
 * Wrapper component that provides FormContext
 */
function FormWrapper({
  children,
  defaultValues,
}: {
  children: React.ReactNode;
  defaultValues?: Partial<PromptConfigFormValues>;
}) {
  const methods = useForm<PromptConfigFormValues>({
    defaultValues: {
      ...defaultValues,
      version: {
        parameters: {},
        configData: {
          inputs: [],
          demonstrations: { inline: { records: {} } },
        },
        ...(defaultValues?.version ?? {}),
      },
    },
  });

  return <FormProvider {...methods}>{children}</FormProvider>;
}

const renderConversationSection = ({
  props = {},
  formValues,
}: {
  props?: Partial<Parameters<typeof PromptConversationSection>[0]>;
  formValues?: Partial<PromptConfigFormValues>;
} = {}) => {
  const defaultProps = {
    layoutMode: "vertical" as const,
    isPromptExpanded: true,
    onPositionChange: vi.fn(),
    onDragEnd: vi.fn(),
    onToggle: vi.fn(),
    ...props,
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <FormWrapper defaultValues={formValues}>
        <PromptConversationSection {...defaultProps} />
      </FormWrapper>
    </ChakraProvider>,
  );
};

const withInputs = (
  inputs: Array<{ identifier: string; type: string }>,
): Partial<PromptConfigFormValues> => ({
  version: {
    parameters: {},
    configData: {
      inputs,
      demonstrations: { inline: { records: {} } },
    },
  } as any,
});

describe("given the conversation pane", () => {
  beforeEach(() => {
    localStorage.clear();
    clearStoreInstances();
    const store = getStoreForTesting(TEST_PROJECT_ID);
    store.getState().addTab({ data: createTabData() });
  });

  afterEach(() => {
    cleanup();
    clearStoreInstances();
    localStorage.clear();
    // Always restore the shared useTabId mock, even if a test asserted and
    // threw before its own reset, so it can't leak a stale id into later tests.
    tabIdRef.current = "test-tab-id";
  });

  describe("when the panes are stacked vertically", () => {
    it("shows resizable divider in vertical mode", () => {
      renderConversationSection({ props: { layoutMode: "vertical" } });

      expect(screen.getByTestId("resizable-divider")).toBeInTheDocument();
    });

    /** @scenario The drag divider sits above the conversation's bar when the panes are stacked */
    it("puts the divider before the pane bar in document order", () => {
      renderConversationSection({ props: { layoutMode: "vertical" } });

      const divider = screen.getByTestId("resizable-divider");
      const bar = screen.getByText("Conversation");
      // The handle resizes the prompt above it, so it belongs between that and
      // the conversation — not overlapping the bar's own bottom edge.
      expect(
        divider.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario The conversation's bar closes with a hairline in both layouts */
    it("closes the pane bar with a hairline in vertical mode", () => {
      renderConversationSection({ props: { layoutMode: "vertical" } });

      expect(screen.getByTestId("conversation-pane-bar")).toHaveStyle({
        borderBottomStyle: "solid",
      });
    });
  });

  describe("when the panes sit side by side", () => {
    it("hides resizable divider in horizontal mode", () => {
      renderConversationSection({ props: { layoutMode: "horizontal" } });

      expect(screen.queryByTestId("resizable-divider")).not.toBeInTheDocument();
    });

    /** @scenario The conversation's bar closes with a hairline in both layouts */
    it("closes the pane bar with a hairline in horizontal mode", () => {
      renderConversationSection({ props: { layoutMode: "horizontal" } });

      expect(screen.getByTestId("conversation-pane-bar")).toHaveStyle({
        borderBottomStyle: "solid",
      });
    });
  });

  describe("when either layout is showing", () => {
    /** @scenario The conversation pane offers no sub-tabs */
    it("offers no sub-tabs", () => {
      renderConversationSection({ props: { layoutMode: "vertical" } });

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getByTestId("playground-chat")).toBeInTheDocument();
    });

    it("shows Reset chat button in both modes", () => {
      renderConversationSection({ props: { layoutMode: "vertical" } });
      expect(
        screen.getByRole("button", { name: /reset chat/i }),
      ).toBeInTheDocument();

      cleanup();

      renderConversationSection({ props: { layoutMode: "horizontal" } });
      expect(
        screen.getByRole("button", { name: /reset chat/i }),
      ).toBeInTheDocument();
    });
  });

  describe("when the prompt declares an input variable", () => {
    /** @scenario The message box is the only field for the input variable */
    it("never offers input a field of its own", () => {
      renderConversationSection({
        props: { layoutMode: "vertical" },
        formValues: withInputs([
          { identifier: "input", type: "str" },
          { identifier: "topic", type: "str" },
        ]),
      });

      expect(screen.queryByLabelText("Set input")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Set topic")).toBeInTheDocument();
    });

    /** @scenario The message box is the only field for the input variable */
    it("sends input empty so the message always supplies it", () => {
      const store = getStoreForTesting(TEST_PROJECT_ID);
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      tabIdRef.current = tabId!;
      // A value left behind by an older version of the playground.
      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          variableValues: { input: "stale" },
        }),
      });

      renderConversationSection({
        props: { layoutMode: "vertical" },
        formValues: withInputs([{ identifier: "input", type: "str" }]),
      });

      // The chat stub renders a field per variable it is given; `input` never
      // reaches it, so the stale value cannot beat what the user types.
      expect(screen.queryByLabelText("Set input")).not.toBeInTheDocument();
    });
  });

  describe("when a variable value is set and the tab unmounts immediately", () => {
    it("flushes the pending write so the edit is not lost", async () => {
      const user = userEvent.setup();
      const store = getStoreForTesting(TEST_PROJECT_ID);
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      // Point the component's useTabId() at the real store tab so its writes land.
      tabIdRef.current = tabId!;

      const { unmount } = renderConversationSection({
        props: { layoutMode: "vertical" },
        formValues: withInputs([{ identifier: "topic", type: "str" }]),
      });

      await user.type(screen.getByLabelText("Set topic"), "flushed");

      // The 300ms debounce has NOT fired yet (test is faster). Unmounting the
      // tab (as switching prompt tabs does) must flush the pending write rather
      // than cancel it — otherwise the edit is lost.
      unmount();

      expect(store.getState().getByTabId(tabId!)?.variableValues.topic).toBe(
        "flushed",
      );
    });
  });

  describe("when a tab is switched away from and reopened", () => {
    it("restores the variable value the user had typed", async () => {
      const user = userEvent.setup();
      const store = getStoreForTesting(TEST_PROJECT_ID);
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      tabIdRef.current = tabId!;

      const formValues = withInputs([{ identifier: "topic", type: "str" }]);

      // Mount, type a value, then unmount — this is "switch away".
      const first = renderConversationSection({
        props: { layoutMode: "vertical" },
        formValues,
      });
      await user.type(screen.getByLabelText("Set topic"), "kept");
      first.unmount();

      // "Switch back": a fresh mount of the same tab must show the value again,
      // proving the full round-trip (flush on unmount -> restore from store).
      renderConversationSection({
        props: { layoutMode: "vertical" },
        formValues,
      });
      expect(screen.getByLabelText("Set topic")).toHaveValue("kept");
    });
  });
});
