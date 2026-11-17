/**
 * The + on the suite rail and the template gallery it opens: tabs, preview, fit and create.
 * @vitest-environment jsdom
 * @see modules/scenario/specs/suite-template-gallery.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { SuiteTemplate } from "@langwatch/suite-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SuiteRailAddMenu } from "../../suite-rail/suite-rail-add-menu.tsx";
import { AGENT_NAME_REQUIRED, TEMPLATES_LOAD_FAILED } from "../suite-template-gallery-dialog.tsx";
import { SuiteTemplateGallery } from "../suite-template-gallery.tsx";
import { TEMPLATE_CREATE_FAILED } from "../use-suite-template-gallery.ts";

const mockTemplatesQuery = vi.hoisted(() => vi.fn());
const mockApply = vi.hoisted(() => vi.fn());
const mockShowErrorToast = vi.hoisted(() => vi.fn());
const applyHooks = vi.hoisted(
  () => ({}) as { onSuccess?: (value: unknown) => unknown; onError?: (error: unknown) => void },
);

vi.mock("../../../../../behavior/scenario-api.ts", () => ({
  api: {
    useUtils: () => ({
      suites: { testSuites: { getAll: { invalidate: () => Promise.resolve() } } },
    }),
    suites: {
      testSuites: {
        listTemplates: { useQuery: (...args: unknown[]) => mockTemplatesQuery(...args) },
        applyTemplate: {
          useMutation: (options: typeof applyHooks) => {
            applyHooks.onSuccess = options.onSuccess;
            applyHooks.onError = options.onError;
            return { mutate: mockApply, isPending: false };
          },
        },
      },
    },
  },
}));
vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({ scenarios: { getAll: { invalidate: () => Promise.resolve() } } }),
  },
}));
vi.mock("@langwatch/browser-host/errors", () => ({ showErrorToast: mockShowErrorToast }));

const ARCHETYPE: SuiteTemplate = {
  id: "support-agent",
  version: 1,
  kind: "archetype",
  title: "Support agent",
  description: "The everyday paths of a support agent.",
  criteria: [],
  scenarios: [
    {
      key: "refund",
      name: "Refund request",
      situation: "Asks for a refund",
      criteria: ["c"],
      labels: [],
    },
    {
      key: "order",
      name: "Order status",
      situation: "Asks about an order",
      criteria: ["c"],
      labels: [],
    },
  ],
};

const RED_TEAM: SuiteTemplate = {
  id: "owasp-llm-top-10-2025",
  version: 1,
  kind: "red_team_pack",
  title: "OWASP LLM Top 10",
  description: "One attack per risk.",
  criteria: [],
  scenarios: [
    {
      key: "llm01",
      name: "Prompt Injection",
      situation: "An attacker",
      criteria: ["c"],
      labels: [],
      attack: {
        attackGoal: "Make the agent ignore its instructions",
        owaspIds: ["LLM01"],
        strategy: "crescendo",
        maxTurns: 6,
      },
    },
  ],
};

function answer(state: Partial<{ data: unknown; isLoading: boolean; error: unknown }>) {
  mockTemplatesQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  });
}

const onCreated = vi.fn();

function renderGallery() {
  return renderWithDesignSystem(
    <SuiteTemplateGallery projectId="proj_1" onClose={vi.fn()} onCreated={onCreated} />,
  );
}

async function goToFit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("suite-template-tab-red_team_pack"));
  await user.click(await screen.findByTestId(`suite-template-card-${RED_TEAM.id}`));
  await user.click(await screen.findByTestId("suite-template-next"));
  await screen.findByTestId("suite-template-fit");
}

beforeEach(() => {
  vi.clearAllMocks();
  answer({ data: [ARCHETYPE, RED_TEAM] });
});
afterEach(cleanup);

describe("SuiteRailAddMenu", () => {
  /** @scenario "The add control offers a blank suite or a template" */
  it("offers a blank suite and a template when opened", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<SuiteRailAddMenu onBlankSuite={vi.fn()} onFromTemplate={vi.fn()} />);
    await user.click(screen.getByTestId("agent-testing-rail-new-suite"));
    expect(await screen.findByText("Blank suite")).toBeInTheDocument();
    expect(screen.getByText("From template")).toBeInTheDocument();
  });

  /** @scenario "Blank suite keeps the naming dialog" */
  it("runs the blank suite flow when Blank suite is chosen", async () => {
    const user = userEvent.setup();
    const onBlankSuite = vi.fn();
    const onFromTemplate = vi.fn();
    renderWithDesignSystem(
      <SuiteRailAddMenu onBlankSuite={onBlankSuite} onFromTemplate={onFromTemplate} />,
    );
    await user.click(screen.getByTestId("agent-testing-rail-new-suite"));
    await user.click(await screen.findByTestId("agent-testing-rail-new-blank-suite"));
    expect(onBlankSuite).toHaveBeenCalledOnce();
    expect(onFromTemplate).not.toHaveBeenCalled();
  });
});

describe("SuiteTemplateGallery", () => {
  /** @scenario "The gallery sorts templates into archetypes and red team packs" */
  it("shows archetypes and red team packs on their own tabs", async () => {
    const user = userEvent.setup();
    renderGallery();
    expect(screen.getByTestId(`suite-template-card-${ARCHETYPE.id}`)).toBeInTheDocument();
    expect(screen.getByText(ARCHETYPE.description)).toBeInTheDocument();
    expect(screen.getByText("2 scenarios")).toBeInTheDocument();
    expect(screen.queryByTestId(`suite-template-card-${RED_TEAM.id}`)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("suite-template-tab-red_team_pack"));
    expect(await screen.findByTestId(`suite-template-card-${RED_TEAM.id}`)).toBeInTheDocument();
  });

  /** @scenario "The gallery shows loading while the templates are read" */
  it("shows a loading state before the templates answer", () => {
    answer({ isLoading: true });
    renderGallery();
    expect(screen.getByTestId("suite-template-loading")).toBeInTheDocument();
  });

  /** @scenario "A tab with no template says so" */
  it("says a tab has no template of its kind", () => {
    answer({ data: [RED_TEAM] });
    renderGallery();
    expect(screen.getByTestId("suite-template-empty-archetype")).toBeInTheDocument();
  });

  /** @scenario "The template list fails to load" */
  it("says the templates could not be loaded", () => {
    answer({ error: new Error("boom") });
    renderGallery();
    expect(screen.getByText(TEMPLATES_LOAD_FAILED)).toBeInTheDocument();
  });

  /** @scenario "Choosing a red team pack previews each attack" */
  it("previews each attack with its goal and OWASP ids", async () => {
    const user = userEvent.setup();
    renderGallery();
    await user.click(screen.getByTestId("suite-template-tab-red_team_pack"));
    await user.click(await screen.findByTestId(`suite-template-card-${RED_TEAM.id}`));
    const preview = await screen.findByTestId("suite-template-preview-llm01");
    expect(preview).toHaveTextContent("Prompt Injection");
    expect(preview).toHaveTextContent("Make the agent ignore its instructions");
    expect(preview).toHaveTextContent("LLM01");
  });

  /** @scenario "The fit step needs the agent name" */
  it("asks for the agent name and creates nothing without it", async () => {
    const user = userEvent.setup();
    renderGallery();
    await goToFit(user);
    await user.click(screen.getByTestId("suite-template-create"));
    expect(await screen.findByText(AGENT_NAME_REQUIRED)).toBeInTheDocument();
    expect(mockApply).not.toHaveBeenCalled();
  });

  /** @scenario "Create applies the template and opens the new suite" */
  it("applies the template with the fit and opens the new suite", async () => {
    const user = userEvent.setup();
    renderGallery();
    await goToFit(user);
    await user.type(screen.getByTestId("suite-template-agent-name"), "Refunds bot");
    await user.type(screen.getByTestId("suite-template-tool-input"), "issue_refund{Enter}");
    await user.type(screen.getByTestId("suite-template-tool-input"), "lookup_order{Enter}");
    expect(screen.getByTestId("suite-template-tool-issue_refund")).toBeInTheDocument();
    await user.type(
      screen.getByTestId("suite-template-must-never"),
      "refund without an order{Enter}share another customer's data",
    );
    await user.type(screen.getByTestId("suite-template-suite-name"), "Refunds red team");
    await user.click(screen.getByTestId("suite-template-create"));

    expect(mockApply).toHaveBeenCalledWith({
      projectId: "proj_1",
      templateId: RED_TEAM.id,
      fit: {
        agentName: "Refunds bot",
        tools: ["issue_refund", "lookup_order"],
        mustNever: ["refund without an order", "share another customer's data"],
      },
      name: "Refunds red team",
    });

    const applied = {
      suiteId: "s1",
      slug: "refunds-red-team",
      name: "Refunds red team",
      scenarioIds: ["a"],
    };
    await applyHooks.onSuccess?.(applied);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(applied));
  });

  /** @scenario "A refused create keeps the dialog open" */
  it("reports a refused create through the shared toast and stays on the fit step", async () => {
    const user = userEvent.setup();
    renderGallery();
    await goToFit(user);
    await user.type(screen.getByTestId("suite-template-agent-name"), "Refunds bot");
    await user.click(screen.getByTestId("suite-template-create"));
    const error = new Error("nope");
    applyHooks.onError?.(error);
    expect(mockShowErrorToast).toHaveBeenCalledWith({
      error,
      fallbackTitle: TEMPLATE_CREATE_FAILED,
    });
    expect(screen.getByTestId("suite-template-fit")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  /** @scenario "The Free plan cap shows the existing upgrade message" */
  it("hands the scenario limit refusal to the shared handler and draws nothing of its own", async () => {
    const user = userEvent.setup();
    renderGallery();
    await goToFit(user);
    await user.type(screen.getByTestId("suite-template-agent-name"), "Refunds bot");
    await user.click(screen.getByTestId("suite-template-create"));
    const limit = Object.assign(new Error("limit"), { data: { code: "limit_exceeded" } });
    applyHooks.onError?.(limit);
    expect(mockShowErrorToast).toHaveBeenCalledWith(expect.objectContaining({ error: limit }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
