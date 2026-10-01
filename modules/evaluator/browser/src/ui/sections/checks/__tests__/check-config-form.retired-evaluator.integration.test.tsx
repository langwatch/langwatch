// @vitest-environment jsdom

import { DEFAULT_MAPPINGS } from "@langwatch/dataset-contract";
/**
 * A monitor can carry a retired `checkType`; the edit page must survive it.
 * Drives the real `CheckConfigForm`, since the failure mode is a runtime `TypeError`.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { EvaluationExecutionMode } from "@langwatch/workflow-contract";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
  }),
}));

// The mapping editor mounts the whole trace host; what the form does with a
// definition it cannot resolve is decided before any mapping is drawn.
vi.mock("../../../../behavior/lent-peers.tsx", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EvaluatorTracesMapping: () => null,
}));

// The drawer navigator reads a react-router location this package never
// mounts; only `openDrawer` is reachable from the form's "Try it out" panel.
vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

// The manual-integration panel mints a token through the api-key client's own tRPC.
vi.mock("@langwatch/api-key-client", () => ({
  useMintPersonalToken: () => ({
    token: void 0,
    isMinting: false,
    scopeNote: "",
    mint: async () => void 0,
  }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/evaluations/[id]/edit",
    query: { project: "proj-1", id: "monitor-1" },
    push: vi.fn(),
    replace: vi.fn(),
    asPath: "/proj-1/evaluations/monitor-1/edit",
    isReady: true,
  }),
}));

// tRPC is the boundary. The form's subtree reaches dozens of procedures that
// say nothing about which evaluator definition it resolved, so every procedure
// answers with an empty, settled result and the few that steer the render are
// named explicitly below.
vi.mock("../../../../behavior/evaluator-api.ts", () => {
  const emptyQuery = () => ({
    data: void 0,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => void 0,
  });
  const emptyMutation = () => ({
    mutate: () => void 0,
    mutateAsync: async () => ({}),
    isLoading: false,
    isPending: false,
  });

  const hooks: Record<string, () => unknown> = {
    useQuery: emptyQuery,
    useInfiniteQuery: emptyQuery,
    useMutation: emptyMutation,
    // `useAvailableEvaluators` returns undefined until this settles, and
    // undefined short-circuits the guard under test, so it has to be a loaded
    // empty list rather than a pending one.
    "evaluations.availableCustomEvaluators.useQuery": () => ({
      data: [],
      isLoading: false,
    }),
    "monitors.isNameAvailable.useMutation": () => ({
      mutateAsync: async () => ({ available: true }),
    }),
    "modelProvider.listAllForProjectForFrontend.useQuery": () => ({
      data: [],
      isLoading: false,
    }),
  };

  const stub = (path: string): unknown =>
    new Proxy(() => [], {
      get: (_target, prop: string) => {
        const next = path ? `${path}.${prop}` : prop;
        return hooks[next] ?? hooks[prop] ?? stub(next);
      },
      apply: () => [],
    });

  return { evaluatorApi: stub("") };
});

import CheckConfigForm, { type CheckConfigFormData } from "../check-config-form.tsx";

afterEach(() => cleanup());

const RETIRED_CHECK_TYPE = "legacy/ragas_faithfulness";

function renderForm(checkType: string) {
  return renderWithDesignSystem(
    <CheckConfigForm
      checkId="monitor-1"
      defaultValues={{
        name: "My Faithfulness Check",
        checkType: checkType as never,
        sample: 1,
        preconditions: [],
        settings: { model: "openai/gpt-5-mini", max_tokens: 2048 } as never,
        mappings: void 0 as never,
      }}
      onSubmit={async () => void 0}
      loading={false}
    />,
  );
}

describe("<CheckConfigForm/>", () => {
  describe("given a monitor saved with an evaluator that is no longer in the catalog", () => {
    describe("when the edit page renders it", () => {
      /** @scenario An old evaluation that still names a retired evaluator offers a replacement */
      it("renders the evaluator picker instead of throwing", () => {
        expect(() => renderForm(RETIRED_CHECK_TYPE)).not.toThrow();
      });

      it("names the retired evaluator and asks for a replacement", () => {
        renderForm(RETIRED_CHECK_TYPE);

        expect(screen.getByText("This evaluator is no longer available")).toBeTruthy();
        expect(screen.getByText(new RegExp(RETIRED_CHECK_TYPE))).toBeTruthy();
      });

      it("offers a live evaluator to switch to", () => {
        renderForm(RETIRED_CHECK_TYPE);

        expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
        expect(screen.getByText("Prompt Injection Detection")).toBeTruthy();
      });
    });
  });

  describe("given a monitor saved with an evaluator that is in the catalog", () => {
    describe("when the edit page renders it", () => {
      it("renders the evaluator's configuration form", () => {
        renderForm("ragas/faithfulness");

        expect(screen.getByText("Ragas Faithfulness")).toBeTruthy();
        expect(screen.queryByText("This evaluator is no longer available")).toBeNull();
      });
    });
  });
});

describe("<CheckConfigForm/> saving", () => {
  describe("given a valid monitor on a catalogued evaluator", () => {
    describe("when the user saves it", () => {
      it("submits the parsed values, without the store-settings-on-code toggle", async () => {
        const onSubmit = vi.fn(async (_data: CheckConfigFormData) => void 0);
        const settings = { case_sensitive: false, trim_whitespace: true, remove_punctuation: true };
        renderWithDesignSystem(
          <CheckConfigForm
            checkId="monitor-1"
            defaultValues={{
              name: "Exact",
              checkType: "langevals/exact_match",
              sample: 1,
              preconditions: [],
              settings,
              executionMode: EvaluationExecutionMode.ON_MESSAGE,
              storeSettingsOnCode: false,
              mappings: DEFAULT_MAPPINGS,
            }}
            onSubmit={onSubmit}
            loading={false}
          />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
          name: "Exact",
          checkType: "langevals/exact_match",
          sample: 1,
          preconditions: [],
          settings,
          executionMode: EvaluationExecutionMode.ON_MESSAGE,
          mappings: DEFAULT_MAPPINGS,
        });
      });
    });
  });
});
