// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Insights setup drawer's two edges: its Model row reads Langy's own gate, and Cancel throws
 * the sitting's edits away. Real page over the fake host; the API, the project scope and the
 * model picker (lent by model-provider) are the boundaries doubled.
 * @see specs/governance/governance-platform-placeholders.feature
 */
import { LANGY_CHAT_FEATURE_KEY } from "@langwatch/model-provider-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  resolvedDefault: { calls: [] as unknown[], model: "openai/gpt-5" },
  allowed: { calls: [] as unknown[], models: ["openai/gpt-5", "anthropic/claude-sonnet"] },
  picker: [] as { model: string; options: readonly string[]; mode?: string }[],
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("../../../../behavior/lent-model-provider.tsx", () => ({
  ModelSelector: (props: { model: string; options: readonly string[]; mode?: string }) => {
    harness.picker.push(props);
    return <div data-testid="model-picker" data-model={props.model} />;
  },
}));
vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          const here = path.join(".");
          if (property === "useQuery") {
            return (input: unknown, options?: { enabled?: boolean }) => {
              const asked = options?.enabled !== false;
              if (here === "modelProvider.getResolvedDefault") {
                if (asked) harness.resolvedDefault.calls.push(input);
                return { data: { model: harness.resolvedDefault.model }, isLoading: false };
              }
              if (here === "langy.modelsAllowed") {
                if (asked) harness.allowed.calls.push(input);
                return { data: { modelsAllowed: harness.allowed.models }, isLoading: false };
              }
              return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
            };
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import InsightsScreen from "../insights.tsx";

const FLAGS = ["release_ui_ai_governance_enabled", "release_ui_governance_billed_cost_enabled"];

function open() {
  return renderWithGovernanceHost(<InsightsScreen />, {
    host: fakeGovernanceHost({
      enabledFlags: FLAGS,
      permissions: ["organization:view", "governance:view"],
    }),
  });
}

const openDrawer = () => userEvent.click(screen.getByRole("button", { name: "Set up data" }));
const at = () => document.body.querySelector<HTMLInputElement>('input[type="time"]');

beforeEach(() => {
  harness.resolvedDefault.calls = [];
  harness.allowed.calls = [];
  harness.picker = [];
});
afterEach(() => cleanup());

describe("given the member presses Set up data", () => {
  /** @scenario "The Model row follows Langy's configured model" */
  it("shows the model Langy's gate resolves for the project and offers the models Langy may use through the shared picker", async () => {
    open();
    expect(harness.resolvedDefault.calls).toEqual([]);

    await openDrawer();

    const picker = await screen.findByTestId("model-picker");
    expect(picker).toHaveAttribute("data-model", "openai/gpt-5");
    expect(harness.picker.at(-1)?.options).toEqual(["openai/gpt-5", "anthropic/claude-sonnet"]);
    expect(harness.picker.at(-1)?.mode).toBe("chat");
    expect(harness.resolvedDefault.calls.at(-1)).toEqual({
      projectId: "project-1",
      featureKey: LANGY_CHAT_FEATURE_KEY,
    });
    expect(harness.allowed.calls.at(-1)).toEqual({ projectId: "project-1" });
  }, 30_000);

  /** @scenario "Cancel discards the sitting's edits" */
  it("shows the schedule it had before when the drawer is reopened after Cancel", async () => {
    open();

    await openDrawer();
    expect(at()?.value).toBe("07:00");
    fireEvent.change(at() as HTMLInputElement, { target: { value: "09:30" } });
    expect(at()?.value).toBe("09:30");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Set up Insights")).not.toBeInTheDocument());

    await openDrawer();
    expect(at()?.value).toBe("07:00");
  }, 30_000);
});
