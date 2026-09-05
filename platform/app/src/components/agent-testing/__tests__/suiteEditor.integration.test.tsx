/**
 * @vitest-environment jsdom
 *
 * The suite editor drawer: the name, the fields and the evaluators a test
 * suite declares, the chips that open them, and what a save sends and hears
 * back.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { SUITE_EDITOR_DRAWER } from "../cases/drawerKeys";
import { SuiteEditorDrawer } from "../suite/SuiteEditorDrawer";
import { useSuiteEditorStore } from "../suite/suiteEditorStore";

const mockSuiteGetById = vi.hoisted(() => vi.fn());
const mockEvaluatorsGetAll = vi.hoisted(() => vi.fn());
const mockUpdateMutate = vi.hoisted(() => vi.fn());
const mockEvaluatorFetch = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockCloseDrawer = vi.hoisted(() => vi.fn());
const mockGoBack = vi.hoisted(() => vi.fn());
const updateOptions = vi.hoisted(
  () =>
    ({}) as {
      onSuccess?: (saved: unknown) => void;
      onError?: (error: unknown) => void;
    },
);
const drawerState = vi.hoisted(() => ({
  open: "" as string,
  params: {} as Record<string, string>,
  stack: [] as { drawer: string }[],
}));
const flowCallbacksStore = vi.hoisted(
  () => ({}) as Record<string, Record<string, unknown>>,
);

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
      evaluators: { getById: { fetch: mockEvaluatorFetch } },
    }),
    suites: {
      getById: { useQuery: mockSuiteGetById },
      testSuites: {
        update: {
          useMutation: (options: typeof updateOptions) => {
            updateOptions.onSuccess = options.onSuccess;
            updateOptions.onError = options.onError;
            return { mutate: mockUpdateMutate, isPending: false };
          },
        },
      },
    },
    evaluators: { getAll: { useQuery: mockEvaluatorsGetAll } },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useProjectSpanNames", () => ({
  useProjectSpanNames: () => ({
    spanNames: [{ key: "run_sql", label: "run_sql" }],
    metadataKeys: [],
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToast },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    goBack: mockGoBack,
    drawerOpen: (drawer: string) => drawer === drawerState.open,
  }),
  useDrawerParams: () => drawerState.params,
  getDrawerStack: () => drawerState.stack,
  setFlowCallbacks: (drawer: string, callbacks: Record<string, unknown>) => {
    flowCallbacksStore[drawer] = callbacks;
  },
  getFlowCallbacks: (drawer: string) => flowCallbacksStore[drawer],
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SQL_EVALUATOR = {
  id: "eval_sql",
  name: "SQL Query Equivalence",
  type: "evaluator",
  config: { evaluatorType: "ragas/sql_query_equivalence", settings: {} },
  fields: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
    { identifier: "expected_contexts", type: "str" },
  ],
  outputFields: [
    { identifier: "passed", type: "bool" },
    { identifier: "score", type: "float" },
  ],
};

const PII_EVALUATOR = {
  id: "eval_pii",
  name: "PII Leak Scanner",
  type: "evaluator",
  config: { evaluatorType: "presidio/pii_detection", settings: {} },
  fields: [
    { identifier: "input", type: "str", optional: true },
    { identifier: "output", type: "str", optional: true },
  ],
  outputFields: [{ identifier: "passed", type: "bool" }],
};

const EXACT_MATCH_EVALUATOR = {
  id: "eval_exact",
  name: "Exact Match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match", settings: {} },
  fields: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  outputFields: [{ identifier: "passed", type: "bool" }],
};

const SQL_ATTACHMENT: EvaluatorAttachment = {
  id: "att_sql",
  evaluatorId: "eval_sql",
  required: true,
  mappings: {
    output: {
      type: "source",
      sourceId: "conversation",
      path: ["last_agent_message"],
    },
    expected_output: {
      type: "source",
      sourceId: "scenario",
      path: ["fields", "golden_sql"],
    },
    expected_contexts: {
      type: "source",
      sourceId: "scenario",
      path: ["fields", "table_schema"],
    },
  },
};

function storedSuite(
  overrides: { fields?: unknown; evaluators?: unknown; name?: string } = {},
) {
  return {
    id: "suite_1",
    name: "Refunds",
    slug: "refunds",
    kind: "test_suite",
    fields: null,
    evaluators: null,
    ...overrides,
  };
}

/** A refusal the way tRPC carries a handled error to the client. */
function handledRejection(code: string, meta: Record<string, unknown> = {}) {
  return { data: { error: { code, httpStatus: 422, meta } } };
}

function openEditor(suite = storedSuite()) {
  mockSuiteGetById.mockReturnValue({ data: suite, isLoading: false });
  drawerState.open = SUITE_EDITOR_DRAWER;
  drawerState.params = { testSuiteId: "suite_1" };
  drawerState.stack = [{ drawer: SUITE_EDITOR_DRAWER }];
  return render(<SuiteEditorDrawer />, { wrapper: Wrapper });
}

const draft = () => useSuiteEditorStore.getState().draft;

/** The field identifiers of the draft, in the order the rows read. */
const identifiers = () => (draft()?.fields ?? []).map((row) => row.identifier);

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
 * What dnd-kit is telling screen readers right now. The sensor measures its
 * droppable rects off the main flow, so waiting on the announcement waits on
 * the sensor's own account of what it did rather than on a frame count.
 */
function announcement(): string {
  return document.querySelector("[aria-live]")?.textContent ?? "";
}

describe("the suite editor drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSuiteEditorStore.getState().clear();
    for (const key of Object.keys(flowCallbacksStore)) {
      delete flowCallbacksStore[key];
    }
    mockEvaluatorsGetAll.mockReturnValue({
      data: [SQL_EVALUATOR, PII_EVALUATOR, EXACT_MATCH_EVALUATOR],
      isLoading: false,
    });
    // Closing takes the drawer off the address, the way the router does.
    mockCloseDrawer.mockImplementation(() => {
      drawerState.open = "";
      drawerState.stack = [];
    });
  });

  afterEach(cleanup);

  // --- What the editor holds ---

  /** @scenario "The suite editor is a drawer that answers to the address" */
  it("reads the suite the address names", async () => {
    openEditor();

    expect(await screen.findByTestId("suite-editor")).toBeInTheDocument();
    expect(mockSuiteGetById).toHaveBeenCalledWith(
      { projectId: "proj_1", id: "suite_1" },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByLabelText("Test suite name")).toHaveValue("Refunds");
  });

  /** @scenario "The editor opens with the name and the customize block, and nothing else" */
  /** @scenario "The customize block is pinned to the bottom of the body" */
  it("opens with the name and the two dashed chips, pinned to the foot, and no section", async () => {
    openEditor();

    await screen.findByLabelText("Test suite name");
    const chips = screen.getByTestId("customize-suite-chips");
    expect(chips).toHaveTextContent("Customize test suite");
    expect(screen.getByTestId("customize-chip-suite-fields")).toHaveTextContent(
      "Add fields",
    );
    expect(
      screen.getByTestId("customize-chip-suite-evaluators"),
    ).toHaveTextContent("Add evaluators");
    expect(
      screen.queryByTestId("suite-fields-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("suite-evaluators-section"),
    ).not.toBeInTheDocument();
    // The chip row takes whatever space the name leaves above it.
    expect(
      window.getComputedStyle(chips.parentElement as Element).marginTop,
    ).toBe("auto");
  });

  /** @scenario "Editing a suite opens the sections it already uses" */
  it("opens the sections a stored suite already uses, and offers no chip", async () => {
    openEditor(
      storedSuite({
        fields: [
          { identifier: "golden_sql", type: "text" },
          { identifier: "table_schema", type: "text" },
        ],
        evaluators: [SQL_ATTACHMENT],
      }),
    );

    const fields = await screen.findByTestId("suite-fields-section");
    expect(within(fields).getByLabelText("Field 1 identifier")).toHaveValue(
      "golden_sql",
    );
    expect(within(fields).getByLabelText("Field 2 identifier")).toHaveValue(
      "table_schema",
    );
    const evaluators = screen.getByTestId("suite-evaluators-section");
    expect(
      within(evaluators).getByTestId("evaluator-pill-att_sql"),
    ).toHaveTextContent("SQL Query Equivalence");
    expect(
      screen.queryByTestId("customize-suite-chips"),
    ).not.toBeInTheDocument();
  });

  // --- Fields ---

  describe("when Add fields is chosen", () => {
    /** @scenario "Add fields opens the fields section with its first row in place" */
    /** @scenario "A field row is an identifier and a type, and nothing else" */
    it("opens the section with one empty row, its placeholder and its three types", async () => {
      const user = userEvent.setup();
      openEditor();

      await user.click(
        await screen.findByTestId("customize-chip-suite-fields"),
      );

      const section = screen.getByTestId("suite-fields-section");
      const identifier = within(section).getByLabelText("Field 1 identifier");
      expect(identifier).toHaveValue("");
      expect(identifier).toHaveAttribute("placeholder", "expected_tools");
      const type = within(section).getByLabelText("Field 1 type");
      expect(
        Array.from((type as HTMLSelectElement).options).map((o) => o.text),
      ).toEqual(["Text", "Number", "Boolean"]);
      // An identifier and a type: one text box and one select per row.
      expect(within(section).getAllByRole("textbox")).toHaveLength(1);
      expect(within(section).getAllByRole("combobox")).toHaveLength(1);
      expect(
        screen.queryByTestId("customize-chip-suite-fields"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "Fields can be added and removed" */
    it("adds and removes rows", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          fields: [
            { identifier: "golden_sql", type: "text" },
            { identifier: "table_schema", type: "text" },
          ],
        }),
      );
      await screen.findByTestId("suite-fields-section");

      await user.click(screen.getByTestId("suite-add-field"));
      expect(screen.getByLabelText("Field 3 identifier")).toHaveValue("");

      await user.click(
        within(screen.getByTestId("suite-field-row-0")).getByRole("button", {
          name: "Remove field",
        }),
      );
      expect(identifiers()).toEqual(["table_schema", ""]);
    });

    /** @scenario "The reorder handle appears only when there is more than one field" */
    it("hides the handle while one field stands alone and gives every row one once a second arrives", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({ fields: [{ identifier: "golden_sql", type: "text" }] }),
      );
      await screen.findByTestId("suite-fields-section");

      expect(
        screen.queryByRole("button", { name: "Reorder field" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByTestId("suite-add-field"));

      expect(
        screen.getAllByRole("button", { name: "Reorder field" }),
      ).toHaveLength(2);
    });

    /** @scenario "A field is reordered by its handle" */
    it("moves a row past the next one from the handle and saves the order it reads", async () => {
      const restoreLayout = stubVerticalLayout();
      try {
        const user = userEvent.setup();
        openEditor(
          storedSuite({
            fields: [
              { identifier: "golden_sql", type: "text" },
              { identifier: "table_schema", type: "text" },
            ],
          }),
        );
        await screen.findByTestId("suite-fields-section");

        const [firstHandle] = screen.getAllByRole("button", {
          name: "Reorder field",
        });
        if (!firstHandle) throw new Error("no reorder handle to press");
        // The keys go to the handle rather than to whatever holds focus: what
        // is under test is dnd-kit's sensor, not the drawer's focus trap.
        press({ element: firstHandle, code: "Space" });
        await waitFor(() => expect(announcement()).not.toBe(""));
        const pickedUp = announcement();

        press({ element: firstHandle, code: "ArrowDown" });
        await waitFor(() => expect(announcement()).not.toBe(pickedUp));

        press({ element: firstHandle, code: "Space" });
        await waitFor(() =>
          expect(identifiers()).toEqual(["table_schema", "golden_sql"]),
        );

        await user.click(screen.getByTestId("suite-editor-save"));
        expect(mockUpdateMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            fields: [
              { identifier: "table_schema", type: "text" },
              { identifier: "golden_sql", type: "text" },
            ],
          }),
        );
      } finally {
        restoreLayout();
      }
    });

    /** @scenario "Closing the fields section takes the fields away" */
    it("closes the section, offers the chip again and saves no field", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({ fields: [{ identifier: "golden_sql", type: "text" }] }),
      );
      await screen.findByTestId("suite-fields-section");

      await user.click(
        screen.getByRole("button", { name: "Remove the fields" }),
      );

      expect(
        screen.queryByTestId("suite-fields-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("customize-chip-suite-fields"),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("suite-editor-save"));
      expect(mockUpdateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ fields: [] }),
      );
    });
  });

  // --- Evaluators ---

  describe("when Add evaluators is chosen", () => {
    /** @scenario "Add evaluators opens the evaluators section and the evaluator list" */
    it("opens the section and the evaluator list", async () => {
      const user = userEvent.setup();
      openEditor();

      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );

      expect(
        screen.getByTestId("suite-evaluators-section"),
      ).toBeInTheDocument();
      expect(mockOpenDrawer).toHaveBeenCalledWith("evaluatorList", {
        onClose: mockGoBack,
      });
      expect(flowCallbacksStore.evaluatorList?.onSelect).toEqual(
        expect.any(Function),
      );
    });

    /** @scenario "The evaluators section reads as pills and an Add evaluator button" */
    it("reads the attachments as pills followed by an Add evaluator button", async () => {
      openEditor(
        storedSuite({
          fields: [
            { identifier: "golden_sql", type: "text" },
            { identifier: "table_schema", type: "text" },
          ],
          evaluators: [
            SQL_ATTACHMENT,
            {
              id: "att_pii",
              evaluatorId: "eval_pii",
              required: false,
              mappings: {},
            },
          ],
        }),
      );

      const section = await screen.findByTestId("suite-evaluators-section");
      expect(
        within(section).getByTestId("evaluator-pill-att_sql"),
      ).toHaveTextContent("SQL Query Equivalence");
      expect(
        within(section).getByTestId("evaluator-pill-att_pii"),
      ).toHaveTextContent("PII Leak Scanner");
      const add = within(section).getByTestId("suite-add-evaluator");
      expect(add).toHaveTextContent("Add evaluator");
      expect(window.getComputedStyle(add).borderStyle).not.toBe("dashed");
    });

    /** @scenario "Picking an evaluator attaches it with inferred mappings" */
    it("attaches a picked evaluator with inferred mappings, required, and opens its editor for the golden input", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({ fields: [{ identifier: "golden_sql", type: "text" }] }),
      );
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );

      act(() => {
        (
          flowCallbacksStore.evaluatorList!.onSelect as (
            evaluator: unknown,
          ) => void
        )(SQL_EVALUATOR);
      });

      const attached = draft()?.evaluators[0];
      expect(attached).toMatchObject({
        evaluatorId: "eval_sql",
        required: true,
        mappings: {
          output: {
            type: "source",
            sourceId: "conversation",
            path: ["last_agent_message"],
          },
          expected_output: {
            type: "source",
            sourceId: "scenario",
            path: ["fields", "golden_sql"],
          },
        },
      });
      // An expected-like input asks the person to confirm the field it reads.
      const [drawer, props, navigation] = mockOpenDrawer.mock.calls.at(-1)!;
      expect(drawer).toBe("evaluatorEditor");
      expect(props).toMatchObject({
        evaluatorId: "eval_sql",
        gate: { required: true, canRequire: true },
      });
      expect(navigation).toEqual({ replaceCurrentInStack: true });
    });

    it("attaches an evaluator whose inputs all read something and returns to the editor", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );

      act(() => {
        (
          flowCallbacksStore.evaluatorList!.onSelect as (
            evaluator: unknown,
          ) => void
        )(PII_EVALUATOR);
      });

      expect(draft()?.evaluators[0]).toMatchObject({
        evaluatorId: "eval_pii",
        mappings: {
          input: { sourceId: "conversation", path: ["first_user_message"] },
          output: { sourceId: "conversation", path: ["last_agent_message"] },
        },
      });
      expect(mockGoBack).toHaveBeenCalled();
      expect(mockOpenDrawer).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Picking an evaluator with an unmapped required input opens its editor" */
    it("opens the editor on a picked evaluator whose required input reads nothing", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );

      act(() => {
        (
          flowCallbacksStore.evaluatorList!.onSelect as (
            evaluator: unknown,
          ) => void
        )(EXACT_MATCH_EVALUATOR);
      });

      expect(draft()?.evaluators[0]?.mappings.expected_output).toBeUndefined();
      const [drawer, props] = mockOpenDrawer.mock.calls.at(-1)!;
      expect(drawer).toBe("evaluatorEditor");
      expect(props).toMatchObject({ evaluatorId: "eval_exact" });
    });

    /** @scenario "Picking an evaluator that is already attached opens it" */
    it("opens the attachment that is there instead of attaching the evaluator twice", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          evaluators: [
            {
              id: "att_pii",
              evaluatorId: "eval_pii",
              required: false,
              mappings: {},
            },
          ],
        }),
      );
      await screen.findByTestId("suite-evaluators-section");
      await user.click(screen.getByTestId("suite-add-evaluator"));

      act(() => {
        (
          flowCallbacksStore.evaluatorList!.onSelect as (
            evaluator: unknown,
          ) => void
        )(PII_EVALUATOR);
      });

      expect(draft()?.evaluators).toHaveLength(1);
      const [drawer, props] = mockOpenDrawer.mock.calls.at(-1)!;
      expect(drawer).toBe("evaluatorEditor");
      expect(props).toMatchObject({
        evaluatorId: "eval_pii",
        mappingsConfig: { initialMappings: {} },
      });
    });
  });

  describe("when an evaluator is created from the list", () => {
    const saveCreated = async (evaluator: { id: string; name: string }) => {
      mockEvaluatorFetch.mockResolvedValue(
        [SQL_EVALUATOR, PII_EVALUATOR].find((e) => e.id === evaluator.id),
      );
      await act(async () => {
        await (
          flowCallbacksStore.evaluatorEditor!.onSave as (saved: {
            id: string;
            name: string;
          }) => Promise<boolean>
        )(evaluator);
      });
    };

    /** @scenario "An evaluator created from the list lands its editor on the suite editor" */
    it("resets the stack to the suite editor and stacks the new attachment's editor on it", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({ fields: [{ identifier: "golden_sql", type: "text" }] }),
      );
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );
      mockOpenDrawer.mockClear();

      await saveCreated({ id: "eval_sql", name: "SQL Query Equivalence" });

      expect(draft()?.evaluators[0]).toMatchObject({
        evaluatorId: "eval_sql",
        mappings: {
          expected_output: {
            sourceId: "scenario",
            path: ["fields", "golden_sql"],
          },
        },
      });
      const [reset, editor] = mockOpenDrawer.mock.calls;
      expect(reset).toEqual([
        SUITE_EDITOR_DRAWER,
        { testSuiteId: "suite_1" },
        { resetStack: true },
      ]);
      expect(editor?.[0]).toBe("evaluatorEditor");
      // Pushed, not replacing: back from the editor lands on the suite editor.
      expect(editor?.[2]).toBeUndefined();
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    /** @scenario "An evaluator created from the list that needs no mapping lands on the suite editor" */
    it("attaches an evaluator that needs no mapping and stays on the suite editor", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );
      mockOpenDrawer.mockClear();

      await saveCreated({ id: "eval_pii", name: "PII Leak Scanner" });

      expect(draft()?.evaluators[0]).toMatchObject({
        evaluatorId: "eval_pii",
        mappings: {
          input: { sourceId: "conversation", path: ["first_user_message"] },
        },
      });
      expect(mockOpenDrawer).toHaveBeenCalledTimes(1);
      expect(mockOpenDrawer.mock.calls[0]?.[0]).toBe(SUITE_EDITOR_DRAWER);
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    /** @scenario "Cancelling the evaluator list returns to the suite editor" */
    it("opens the list with a way back to the suite editor", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.click(
        await screen.findByTestId("customize-chip-suite-evaluators"),
      );
      expect(mockOpenDrawer).toHaveBeenLastCalledWith("evaluatorList", {
        onClose: mockGoBack,
      });
    });
  });

  describe("given an attached evaluator", () => {
    /** @scenario "A pill with a missing mapping is marked" */
    /** @scenario "A required evaluator's pill carries the required mark" */
    it("marks a pill whose required input reads nothing, and a required one with a dot", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          evaluators: [
            {
              id: "att_exact",
              evaluatorId: "eval_exact",
              required: true,
              mappings: {
                output: {
                  type: "source",
                  sourceId: "conversation",
                  path: ["last_agent_message"],
                },
              },
            },
            {
              id: "att_pii",
              evaluatorId: "eval_pii",
              required: false,
              mappings: {},
            },
          ],
        }),
      );

      const missing = await screen.findByTestId("evaluator-pill-att_exact");
      expect(missing).toHaveAttribute("data-missing", "true");
      expect(
        within(missing).getByTestId("evaluator-pill-alert-att_exact"),
      ).toBeInTheDocument();
      expect(
        within(missing).getByTestId("evaluator-pill-required-att_exact"),
      ).toHaveAttribute("title", "Required to pass");

      const whole = screen.getByTestId("evaluator-pill-att_pii");
      expect(whole).not.toHaveAttribute("data-missing");
      expect(
        within(whole).queryByTestId("evaluator-pill-required-att_pii"),
      ).not.toBeInTheDocument();

      await user.click(missing);
      const [drawer, props] = mockOpenDrawer.mock.calls.at(-1)!;
      expect(drawer).toBe("evaluatorEditor");
      expect(props).toMatchObject({ evaluatorId: "eval_exact" });
    });

    /** @scenario "A mapping edited in the editor lands on the attachment" */
    /** @scenario "The evaluator editor carries the Required to pass switch" */
    /** @scenario "The evaluator editor offers to remove the evaluator" */
    it("writes a mapping, the gate and a removal from the editor back onto the attachment", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          fields: [{ identifier: "golden_sql", type: "text" }],
          evaluators: [
            {
              id: "att_exact",
              evaluatorId: "eval_exact",
              required: true,
              mappings: {},
            },
          ],
        }),
      );
      await user.click(await screen.findByTestId("evaluator-pill-att_exact"));

      const callbacks = flowCallbacksStore.evaluatorEditor!;
      act(() => {
        (
          callbacks.onMappingChange as (input: string, mapping: unknown) => void
        )("expected_output", {
          type: "source",
          sourceId: "scenario",
          path: ["fields", "golden_sql"],
        });
      });
      expect(draft()?.evaluators[0]?.mappings.expected_output).toEqual({
        type: "source",
        sourceId: "scenario",
        path: ["fields", "golden_sql"],
      });

      act(() => {
        (callbacks.onRequiredChange as (required: boolean) => void)(false);
      });
      expect(draft()?.evaluators[0]?.required).toBe(false);

      act(() => {
        (callbacks.onRemove as () => void)();
      });
      expect(draft()?.evaluators).toEqual([]);
      expect(mockGoBack).toHaveBeenCalled();
    });

    /** @scenario "Closing the evaluators section takes the evaluators away" */
    it("closes the section and offers the chip again", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          evaluators: [
            {
              id: "att_pii",
              evaluatorId: "eval_pii",
              required: false,
              mappings: {},
            },
          ],
        }),
      );
      await screen.findByTestId("suite-evaluators-section");

      await user.click(
        screen.getByRole("button", { name: "Remove the evaluators" }),
      );

      expect(
        screen.queryByTestId("suite-evaluators-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("customize-chip-suite-evaluators"),
      ).toBeInTheDocument();
      expect(draft()?.evaluators).toEqual([]);
    });
  });

  // --- Saving ---

  describe("when the suite is saved", () => {
    /** @scenario "Saving writes the name, the fields and the evaluators" */
    it("sends the name, the fields and the evaluators in one call and closes", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          fields: [
            { identifier: "golden_sql", type: "text" },
            { identifier: "table_schema", type: "text" },
          ],
          evaluators: [SQL_ATTACHMENT],
        }),
      );
      const name = await screen.findByLabelText("Test suite name");
      await user.clear(name);
      await user.type(name, "Case lookups");
      await user.click(screen.getByTestId("suite-editor-save"));

      expect(mockUpdateMutate).toHaveBeenCalledWith({
        projectId: "proj_1",
        testSuiteId: "suite_1",
        name: "Case lookups",
        fields: [
          { identifier: "golden_sql", type: "text" },
          { identifier: "table_schema", type: "text" },
        ],
        evaluators: [SQL_ATTACHMENT],
      });

      act(() => updateOptions.onSuccess?.({ id: "suite_1" }));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Test suite updated" }),
      );
      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(useSuiteEditorStore.getState().draft).toBeNull();
    });

    /** @scenario "The editor refuses an empty name" */
    it("refuses an empty name and sends nothing", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.clear(await screen.findByLabelText("Test suite name"));

      await user.click(screen.getByTestId("suite-editor-save"));

      expect(
        screen.getByText("A test suite needs a name."),
      ).toBeInTheDocument();
      expect(mockUpdateMutate).not.toHaveBeenCalled();
    });

    /** @scenario "The editor refuses an empty field identifier before saving" */
    it("refuses a row with no identifier and sends nothing", async () => {
      const user = userEvent.setup();
      openEditor();
      await user.click(
        await screen.findByTestId("customize-chip-suite-fields"),
      );

      await user.click(screen.getByTestId("suite-editor-save"));

      expect(
        within(screen.getByTestId("suite-field-row-0")).getByText(
          "A field needs an identifier.",
        ),
      ).toBeInTheDocument();
      expect(mockUpdateMutate).not.toHaveBeenCalled();
    });

    /** @scenario "A field identifier the server refuses reads under its row" */
    it("reads an identifier the server refused under its row", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          fields: [
            { identifier: "golden_sql", type: "text" },
            { identifier: "table_schema", type: "text" },
          ],
        }),
      );
      await screen.findByTestId("suite-fields-section");
      await user.click(screen.getByTestId("suite-editor-save"));

      act(() =>
        updateOptions.onError?.(
          handledRejection("suite_field_identifier_invalid", {
            identifier: "table_schema",
          }),
        ),
      );

      const row = screen.getByTestId("suite-field-row-1");
      expect(row).toHaveTextContent("table_schema is not a usable name.");
      expect(screen.getByTestId("suite-field-row-0")).not.toHaveTextContent(
        "usable name",
      );
      expect(mockToast).not.toHaveBeenCalled();
    });

    /** @scenario "A field an evaluator still reads cannot be removed" */
    it("reads a field still in use under the fields section", async () => {
      const user = userEvent.setup();
      openEditor(
        storedSuite({
          fields: [{ identifier: "golden_sql", type: "text" }],
          evaluators: [SQL_ATTACHMENT],
        }),
      );
      await screen.findByTestId("suite-fields-section");
      await user.click(
        within(screen.getByTestId("suite-field-row-0")).getByRole("button", {
          name: "Remove field",
        }),
      );
      await user.click(screen.getByTestId("suite-editor-save"));

      act(() =>
        updateOptions.onError?.(
          handledRejection("suite_field_in_use", {
            identifier: "golden_sql",
            evaluatorIds: ["eval_sql"],
          }),
        ),
      );

      expect(screen.getByTestId("suite-fields-section")).toHaveTextContent(
        "Change the evaluator mappings that read golden_sql first, then remove the field.",
      );
      expect(mockToast).not.toHaveBeenCalled();
    });

    /** @scenario "A refusal the editor cannot place reads as a toast" */
    it("toasts a refusal it has no field for and stays open", async () => {
      const user = userEvent.setup();
      openEditor();
      await screen.findByLabelText("Test suite name");
      await user.click(screen.getByTestId("suite-editor-save"));

      act(() => updateOptions.onError?.(new Error("network down")));

      await waitFor(() => expect(mockToast).toHaveBeenCalled());
      expect(mockCloseDrawer).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Test suite name")).toHaveValue("Refunds");
    });
  });
});
