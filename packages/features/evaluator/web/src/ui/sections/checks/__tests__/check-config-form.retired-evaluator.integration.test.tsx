// @vitest-environment jsdom

/**
 * A monitor can carry a `checkType` that is no longer in the catalog. Migration
 * `20250105132258_migrate_legacy_ragas` rewrote saved rows onto the
 * `legacy/ragas_*` slugs, and those evaluators are gone, so the edit page has to
 * survive a definition it cannot resolve.
 *
 * This drives the real `CheckConfigForm` with a retired `checkType` and observes
 * whether it renders, because the failure mode is a runtime `TypeError` at the
 * first dereference of `availableEvaluators[checkType]` rather than a wrong
 * string. The control renders the same form with a live slug, so a mock that
 * broke rendering outright would fail both cases rather than look like a fix.
 *
 * @see specs/npx-installer/07-lean-install.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/ui-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
  }),
}));

// The mapping editor mounts the whole trace host; what the form does with a
// definition it cannot resolve is decided before any mapping is drawn.
vi.mock("../../../elements/evaluations/evaluator-traces-mapping", () => ({
  EvaluatorTracesMapping: () => null,
}));

// The drawer navigator reads a react-router location this package never
// mounts; only `openDrawer` is reachable from the form's "Try it out" panel.
vi.mock("@langwatch/ui-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
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
vi.mock("@langwatch/workflow-web/studio-host/api", () => {
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

  return { api: stub("") };
});

import CheckConfigForm from "../check-config-form";

afterEach(() => cleanup());

const RETIRED_CHECK_TYPE = "legacy/ragas_faithfulness";

function renderForm(checkType: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
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
      />
    </ChakraProvider>,
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
