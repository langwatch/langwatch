/**
 * @vitest-environment jsdom
 * The evaluator picker's category tabs write the chosen category to the URL and keep the rest of
 * the query, and choosing an evaluator sets the form's type and moves on with that query.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { AVAILABLE_EVALUATORS, evaluatorDisplayName } from "@langwatch/evaluator-contract";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const router = vi.hoisted((): { push: Mock; replace: Mock; query: Record<string, string> } => ({
  push: vi.fn(),
  replace: vi.fn(),
  query: {},
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/evaluations/choose",
    query: router.query,
    push: router.push,
    replace: router.replace,
    isReady: true,
  }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "proj-1" },
    organization: { id: "org-1" },
  }),
}));
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));
vi.mock("../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    evaluations: {
      availableEvaluators: { useQuery: () => ({ data: void 0, isLoading: false }) },
      availableCustomEvaluators: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import type { CheckConfigFormData } from "../ui/sections/checks/check-config-form.tsx";
import { EvaluatorSelection } from "../ui/sections/checks/evaluator-selection.tsx";

function Harness() {
  const form = useForm<CheckConfigFormData>();
  return (
    <>
      <EvaluatorSelection form={form} />
      <output data-testid="check-type">{form.watch("checkType")}</output>
    </>
  );
}

const safetyEntry = Object.entries(AVAILABLE_EVALUATORS).find(
  ([key, evaluator]) => evaluator.category === "safety" && !key.startsWith("example/"),
);

describe("the evaluator picker", () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    router.query = { project: "proj-1", returnTo: "monitor-1" };
  });
  afterEach(cleanup);

  describe("given no category in the URL", () => {
    it("opens on Safety and writes a chosen category to the URL, keeping the other params", async () => {
      renderWithDesignSystem(<Harness />);

      expect(screen.getByRole("tab", { name: /safety/i })).toHaveAttribute("aria-selected", "true");
      await userEvent.click(screen.getByRole("tab", { name: /quality/i }));

      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/[project]/evaluations/choose",
        query: { project: "proj-1", returnTo: "monitor-1", tab: "quality" },
      });
    });
  });

  describe("given a category in the URL", () => {
    it("shows that category as selected and replaces it when another is chosen", async () => {
      router.query = { project: "proj-1", tab: "rag" };
      renderWithDesignSystem(<Harness />);

      expect(screen.getByRole("tab", { name: /rag/i })).toHaveAttribute("aria-selected", "true");
      await userEvent.click(screen.getByRole("tab", { name: /policy/i }));

      expect(router.replace).toHaveBeenCalledWith({
        pathname: "/[project]/evaluations/choose",
        query: { project: "proj-1", tab: "policy" },
      });
    });
  });

  describe("when an evaluator card is chosen", () => {
    it("sets the form's type and moves on, dropping /choose and keeping the query", async () => {
      expect(safetyEntry).toBeDefined();
      renderWithDesignSystem(<Harness />);

      const panel = screen.getByRole("tabpanel", { name: /safety/i });
      const heading = within(panel).getAllByRole("heading", {
        name: evaluatorDisplayName(safetyEntry?.[1].name ?? ""),
      })[0];
      const card = heading?.closest("button");
      if (!card) throw new Error("the evaluator card is not a button");
      await userEvent.click(card);

      expect(screen.getByTestId("check-type")).toHaveTextContent(/\S/);
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/[project]/evaluations",
        query: { project: "proj-1", returnTo: "monitor-1" },
      });
    });
  });
});
