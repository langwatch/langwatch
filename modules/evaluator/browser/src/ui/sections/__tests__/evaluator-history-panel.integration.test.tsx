/**
 * @vitest-environment jsdom
 * Spec: modules/evaluator/specs/evaluator-versioning.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorHistoryPanel } from "../evaluator-history-panel.tsx";
import { renderWithEvaluatorHost } from "./testing.tsx";

const calls = vi.hoisted(() => ({
  assignLabel: vi.fn(async (input: unknown) => input),
  removeLabel: vi.fn(async () => undefined),
  invalidateVersions: vi.fn(async () => undefined),
}));

const versions = vi.hoisted(() => {
  const ada = { id: "user_ada", name: "Ada", email: "ada@example.com" };
  const row = (version: number, labels: string[], commitMessage: string | null) => ({
    id: `version_${version}`,
    evaluatorId: "eval_1",
    projectId: "proj-1",
    version,
    name: "Answer relevancy",
    type: "evaluator",
    config: {},
    workflowId: null,
    commitMessage,
    authorId: ada.id,
    authorKind: "user",
    author: ada,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    labels,
  });
  return {
    versions: [row(2, [], "Raise the threshold"), row(1, ["production"], null)],
    labels: [
      {
        label: "production",
        versionId: "version_1",
        version: 1,
        updatedAt: new Date("2026-08-01T00:00:00Z"),
        updatedById: "user_ada",
      },
    ],
    availableLabels: ["production", "staging"],
  };
});

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: () => undefined }),
}));

vi.mock("@langwatch/evaluator-client", () => {
  const mutation = (spy: (input: never) => Promise<unknown>) => ({
    useMutation: () => ({ mutateAsync: spy, isPending: false }),
  });
  return {
    evaluatorClient: {
      useUtils: () => ({
        evaluators: { listVersions: { invalidate: calls.invalidateVersions } },
      }),
      evaluators: {
        getHistory: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        listVersions: {
          useQuery: () => ({ data: versions, isLoading: false, isError: false }),
        },
        assignLabel: mutation(calls.assignLabel),
        removeLabel: mutation(calls.removeLabel),
      },
    },
  };
});

afterEach(cleanup);

describe("the evaluator history drawer", () => {
  /** @scenario "The evaluator drawer shows versions and opens the deploy dialog" */
  it("lists the versions newest first and deploys staging to a version", async () => {
    renderWithEvaluatorHost(
      <EvaluatorHistoryPanel evaluatorId="eval_1" evaluatorName="Answer relevancy" />,
    );

    const list = await screen.findByTestId("evaluator-versions");
    expect(
      within(list)
        .getAllByText(/^v\d$/)
        .map((node) => node.textContent),
    ).toEqual(["v2", "v1"]);
    expect(within(list).getByText("production")).toBeInTheDocument();
    expect(within(list).getByText("Raise the threshold")).toBeInTheDocument();
    expect(within(list).getAllByText(/^Ada ·/)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    const dialog = await screen.findByRole("dialog");
    for (const label of ["latest", "production", "staging"]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }

    await userEvent.click(within(dialog).getAllByRole("combobox")[1]!);
    await userEvent.click(await screen.findByRole("option", { name: /v2/ }));
    await userEvent.click(screen.getByTestId("evaluator-deploy-save"));

    await waitFor(() =>
      expect(calls.assignLabel).toHaveBeenCalledWith({
        projectId: "proj-1",
        evaluatorId: "eval_1",
        label: "staging",
        version: 2,
      }),
    );
    expect(calls.removeLabel).not.toHaveBeenCalled();
    expect(calls.invalidateVersions).toHaveBeenCalled();
  });

  /** @scenario "The deploy dialog adds a custom label and refuses a reserved one" */
  it("adds a custom label, refuses a reserved one and cancels with Escape", async () => {
    calls.assignLabel.mockClear();
    renderWithEvaluatorHost(
      <EvaluatorHistoryPanel evaluatorId="eval_1" evaluatorName="Answer relevancy" />,
    );
    await screen.findByTestId("evaluator-versions");
    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "+ Add label" }));
    await userEvent.type(within(dialog).getByPlaceholderText(/label name/i), "2");
    expect(within(dialog).getByText(/numbers pick versions/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(within(dialog).queryByPlaceholderText(/label name/i)).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "+ Add label" }));
    await userEvent.type(within(dialog).getByPlaceholderText(/label name/i), "canary{Enter}");
    expect(within(dialog).getByText("canary")).toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole("combobox").at(-1)!);
    await userEvent.click(await screen.findByRole("option", { name: /v1/ }));
    await userEvent.click(screen.getByTestId("evaluator-deploy-save"));

    await waitFor(() =>
      expect(calls.assignLabel).toHaveBeenCalledWith({
        projectId: "proj-1",
        evaluatorId: "eval_1",
        label: "canary",
        version: 1,
      }),
    );
  });
});
