/**
 * @vitest-environment jsdom
 *
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
 * Only the boundaries are mocked: tRPC, the project context and the router.
 *
 * @see specs/npx-installer/07-lean-install.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/evaluations/[id]/edit",
    query: { project: "proj-1", id: "monitor-1" },
    push: vi.fn(),
    replace: vi.fn(),
    asPath: "/proj-1/evaluations/monitor-1/edit",
    isReady: true,
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

// tRPC is the boundary. The form's subtree reaches dozens of procedures that
// say nothing about which evaluator definition it resolved, so every procedure
// answers with an empty, settled result and the few that steer the render are
// named explicitly below.
vi.mock("~/utils/api", () => {
  const emptyQuery = () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => undefined,
  });
  const emptyMutation = () => ({
    mutate: () => undefined,
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
      data: { providers: [] },
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

import CheckConfigForm from "../CheckConfigForm";

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
          mappings: undefined as never,
        }}
        onSubmit={async () => undefined}
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

      /** @scenario An old evaluation that still names a retired evaluator offers a replacement */
      it("names the retired evaluator and asks for a replacement", () => {
        renderForm(RETIRED_CHECK_TYPE);

        expect(screen.getByText("This evaluator is no longer available")).toBeInTheDocument();
        expect(screen.getByText(new RegExp(RETIRED_CHECK_TYPE))).toBeInTheDocument();
      });

      /** @scenario An old evaluation that still names a retired evaluator offers a replacement */
      it("offers a live evaluator to switch to", () => {
        renderForm(RETIRED_CHECK_TYPE);

        expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
        expect(screen.getByText("Prompt Injection Detection")).toBeInTheDocument();
      });
    });
  });

  describe("given a monitor saved with an evaluator that is in the catalog", () => {
    describe("when the edit page renders it", () => {
      it("renders the evaluator's configuration form", () => {
        renderForm("ragas/faithfulness");

        expect(screen.getByText("Ragas Faithfulness")).toBeInTheDocument();
        expect(screen.queryByText("This evaluator is no longer available")).not.toBeInTheDocument();
      });
    });
  });
});
