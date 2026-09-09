/**
 * The addresses the product writes, driven through the real registry.
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { CurrentDrawer } from "@langwatch/ui-drawer";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One stub module, from the export names the registry asks it for.
 */
const stub = vi.hoisted(() => {
  const drawers = async (names: readonly string[]): Promise<Record<string, unknown>> => {
    const { createElement, isValidElement } = await import("react");
    const module: Record<string, unknown> = {};
    for (const name of names) {
      module[name] = (props: Record<string, unknown>) =>
        createElement(
          "div",
          { "data-testid": `drawer-${name}` },
          JSON.stringify(props, (_key, value) => {
            if (isValidElement(value)) return "[element]";
            return typeof value === "function" ? "[callback]" : value;
          }),
        );
    }
    return module;
  };
  return { drawers };
});

vi.mock("@langwatch/scenario-web/drawers", () =>
  stub.drawers([
    "AgentTestingCaseEditorDrawer",
    "ScenarioRunDetailDrawer",
    "ScenarioFormDrawerFromUrl",
    "SuiteFormDrawer",
    "ScenarioVersionHistoryDrawer",
  ]),
);

vi.mock("@langwatch/agent-web/agent-editors", () =>
  stub.drawers([
    "AgentCodeEditorDrawer",
    "WorkflowSelectorDrawer",
    "AgentListDrawer",
    "AgentWorkflowTargetEditorDrawer",
    "ConnectedAgentDrawer",
    "ConnectFromCodeDrawer",
    "AgentWorkflowEditorDrawer",
    "AgentTestPanel",
  ]),
);
vi.mock("@langwatch/agent-web/agent-http-editor", () => stub.drawers(["AgentHttpEditorDrawer"]));

const agentCalls = vi.hoisted(() => ({
  address: "",
  getById: vi.fn<(input: { id: string; projectId: string }) => void>(),
}));
vi.mock("@langwatch/agent-web/agent-client", () => ({
  agentApi: {
    Provider: ({ children }: { children: ReactNode }) => children,
    agents: {
      getById: {
        useQuery: (input: { id: string; projectId: string }) => {
          agentCalls.getById(input);
          return {
            data: {
              id: input.id,
              name: "Agent",
              projectId: input.projectId,
              type: agentCalls.address.includes("agentConnectedDetail") ? "connected" : "workflow",
              workflowId: "workflow_1",
              config: { workflow_id: "workflow_1" },
            },
            isLoading: false,
            error: null,
          };
        },
      },
      getAll: { useQuery: () => ({ data: [], isLoading: false, error: null }) },
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      update: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      cascadeArchive: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        getRelatedEntities: { fetch: vi.fn() },
      },
    }),
  },
}));
vi.mock("@langwatch/scenario-web/screens/simulations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/scenario-web/screens/simulations")>()),
  useScenarioHost: () => ({ project: () => ({ id: "project_1", slug: "acme-app" }) }),
  scenarioApi: {
    Provider: ({ children }: { children: ReactNode }) => children,
    httpProxy: { execute: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) } },
    workflow: { create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) } },
  },
}));
vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
  api: { workflow: { getById: { useQuery: () => ({ data: void 0, isLoading: false }) } } },
}));
vi.mock("@langwatch/ui-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/ui-host/capabilities")>()),
  useUiCapabilities: () => ({
    session: { activeScope: () => ({ projectId: "project_1", projectSlug: "acme-app" }) },
    feedback: { succeeded: vi.fn(), failed: vi.fn() },
  }),
}));

vi.mock("@langwatch/evaluator-web/drawers", () =>
  stub.drawers(["GuardrailsDrawer", "EvaluatorHistoryPanel", "EvaluatorListDrawer"]),
);

vi.mock("@langwatch/evaluator-web/editor-drawers", () =>
  stub.drawers([
    "OnlineEvaluationDrawer",
    "WorkflowSelectorForEvaluatorDrawer",
    "CodeEvaluatorEditorDrawer",
    "EvaluatorCategorySelectorDrawer",
    "EvaluatorEditorDrawer",
  ]),
);

// The three other packages `studio-host-drawers` names at module scope. They
// are never opened here; they are stubbed so loading that one chunk does not
// drag a spreadsheet editor and a CSV parser in behind it.
vi.mock("@langwatch/dataset-web/surfaces/dataset-drawer", () =>
  stub.drawers(["AddOrEditDatasetDrawer"]),
);
vi.mock("@langwatch/dataset-web/surfaces/upload-csv-drawer", () =>
  stub.drawers(["UploadCSVDrawer"]),
);
vi.mock("@langwatch/prompt-web/surfaces/prompt-editor-drawer", () =>
  stub.drawers(["PromptEditorDrawer"]),
);

vi.mock("@langwatch/organization-web/drawers", () =>
  stub.drawers(["InviteMemberDrawer", "CreateTeamDrawer"]),
);

vi.mock("@langwatch/gateway-web/drawers", () => stub.drawers(["RoutingPolicyDrawer"]));

vi.mock("@langwatch/automation-web/drawers", () =>
  stub.drawers(["AutomationDrawer", "ViewAutomationDrawer"]),
);

vi.mock("@langwatch/ops-web/drawers", async () => {
  const { createElement } = await import("react");
  const module = await stub.drawers(["FoundryDrawer"]);
  return {
    ...module,
    // The runtime the playground reads its project and API key through. The
    // application mounts it around the drawer, so it has to pass children
    // through or nothing renders at all.
    FoundryTransport: ({ children }: { children: ReactNode }) =>
      createElement("div", { "data-testid": "foundry-transport" }, children),
  };
});

/**
 * Every family's host wrapper, as an identity.
 */
const passThroughHost = vi.hoisted(
  () => () =>
    ({
      withWorkflowHost: <P,>(Component: P) => Component,
      WorkflowHost: ({ children }: { children: ReactNode }) => children,
    }) as Record<string, unknown>,
);

/** The folded hosts: a component now, not a HOC, so the pass-through renders children. */
const passThroughHostComponent = vi.hoisted(
  () => () =>
    ({
      GatewayHost: ({ children }: { children: ReactNode }) => children,
      OrganizationHost: ({ children }: { children: ReactNode }) => children,
      AutomationsHost: ({ children }: { children: ReactNode }) => children,
    }) as Record<string, unknown>,
);

/**
 * Simulations: `ScenarioHost` is a component now, `withScenarioDrawerHost`
 * stays a HOC — a drawer mounts its own host beside the page's, not inside it.
 */
const passThroughScenarioHost = vi.hoisted(
  () => () =>
    ({
      ScenarioHost: ({ children }: { children: ReactNode }) => children,
      withScenarioDrawerHost: <P,>(Component: P) => Component,
    }) as Record<string, unknown>,
);

/**
 * Ops: its module also exports the two permission constants its own routes
 * file reads, which a full mock must still answer.
 */
const passThroughOpsHost = vi.hoisted(
  () => () =>
    ({
      OpsHost: ({ children }: { children: ReactNode }) => children,
      OPS_VIEW_PERMISSION: "ops:view",
      OPS_MANAGE_PERMISSION: "ops:manage",
    }) as Record<string, unknown>,
);

vi.mock("../src/features/simulations/ui/sections/host", passThroughScenarioHost);
vi.mock("../src/features/workflows/ui/sections/workflows-host", passThroughHost);
vi.mock("../src/features/organization/ui/sections/organization-host", passThroughHostComponent);
vi.mock("../src/features/ops/ui/sections/ops-host", passThroughOpsHost);
vi.mock("../src/features/gateway/ui/sections/gateway-host", passThroughHostComponent);
vi.mock("../src/features/automations/ui/sections/automations-host", passThroughHostComponent);

import { installedUiDrawers } from "../src/features/installed-ui-features";

// This package runs without vitest globals, so testing-library never registers
// its own auto-cleanup: without this one case's drawer is still in the document
// when the next one looks for it.
afterEach(() => cleanup());

async function openAddress(address: string, component: string): Promise<string> {
  agentCalls.address = address;
  agentCalls.getById.mockClear();
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[`/acme-app/traces${address}`]}>
        <CurrentDrawer drawers={installedUiDrawers} />
      </MemoryRouter>
    </ChakraProvider>,
  );

  const mounted = await screen.findByTestId(`drawer-${component}`);
  return mounted.textContent ?? "";
}

/**
 * The addresses, as the product writes them.
 */
const OPENINGS: ReadonlyArray<{
  what: string;
  drawer: string;
  address: string;
  component: string;
  carries?: readonly string[];
}> = [
  {
    what: "the agent type selector picking a code agent",
    drawer: "agentCodeEditor",
    address: "?drawer.open=agentCodeEditor",
    component: "AgentCodeEditorDrawer",
  },
  {
    what: "the agent type selector picking an HTTP agent",
    drawer: "agentHttpEditor",
    address: "?drawer.open=agentHttpEditor",
    component: "AgentHttpEditorDrawer",
  },
  {
    what: "the agent type selector picking a workflow agent",
    drawer: "workflowSelector",
    address: "?drawer.open=workflowSelector",
    component: "WorkflowSelectorDrawer",
  },
  {
    what: "the studio agent picker",
    drawer: "agentList",
    address: "?drawer.open=agentList",
    component: "AgentListDrawer",
  },
  {
    what: "the experiments workbench opening a workflow target",
    drawer: "agentWorkflowTargetEditor",
    address: "?drawer.open=agentWorkflowTargetEditor&drawer.agentId=agent_1",
    component: "AgentWorkflowTargetEditorDrawer",
  },
  {
    what: "Agent Testing editing a test case",
    drawer: "agentTestingCaseEditor",
    address: "?drawer.open=agentTestingCaseEditor&drawer.scenarioId=scenario_1",
    component: "AgentTestingCaseEditorDrawer",
    carries: ["scenario_1"],
  },
  {
    what: "the agents page opening a connected agent",
    drawer: "agentConnectedDetail",
    address: "?drawer.open=agentConnectedDetail&drawer.agentId=agent_1",
    component: "ConnectedAgentDrawer",
    carries: ["agent_1"],
  },
  {
    what: "a connected agent offering the code snippet",
    drawer: "agentConnectFromCode",
    address: "?drawer.open=agentConnectFromCode",
    component: "ConnectFromCodeDrawer",
  },
  {
    what: "the run board opening one simulation run",
    drawer: "scenarioRunDetail",
    address: "?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
    component: "ScenarioRunDetailDrawer",
    carries: ["run_1"],
  },
  {
    what: "the Scenario Library editing a test case",
    drawer: "scenarioEditor",
    address: "?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
    component: "ScenarioFormDrawerFromUrl",
    carries: ["scenario_1"],
  },
  {
    what: "the suites table editing a suite",
    drawer: "suiteEditor",
    address: "?drawer.open=suiteEditor&drawer.suiteId=suite_1",
    component: "SuiteFormDrawer",
    carries: ["suite_1"],
  },
  {
    what: "the scenario editor opening a workflow agent",
    drawer: "agentWorkflowEditor",
    address: "?drawer.open=agentWorkflowEditor&drawer.agentId=agent_1",
    component: "AgentWorkflowEditorDrawer",
    carries: ["agent_1"],
  },
  {
    what: "the scenario editor reading a case's version history",
    drawer: "scenarioVersionHistory",
    address:
      "?drawer.open=scenarioVersionHistory&drawer.scenarioId=scenario_1&drawer.markVersion=3",
    component: "ScenarioVersionHistoryDrawer",
    carries: ["scenario_1"],
  },
  {
    what: "the evaluator category selector handing over to a workflow evaluator",
    drawer: "workflowSelectorForEvaluator",
    address: "?drawer.open=workflowSelectorForEvaluator",
    component: "WorkflowSelectorForEvaluatorDrawer",
  },
  {
    what: "the Online Evaluations screen offering guardrails",
    drawer: "guardrails",
    address: "?drawer.open=guardrails",
    component: "GuardrailsDrawer",
  },
  {
    what: "the Members page inviting the address someone typed",
    drawer: "inviteMember",
    address: "?drawer.open=inviteMember&drawer.initialEmail=ada%40example.com",
    component: "InviteMemberDrawer",
    carries: ["ada@example.com"],
  },
  {
    what: "the Teams page creating a team",
    drawer: "createTeam",
    address: "?drawer.open=createTeam",
    component: "CreateTeamDrawer",
  },
  {
    what: "the command palette opening the Foundry",
    drawer: "foundry",
    address: "?drawer.open=foundry",
    component: "FoundryDrawer",
  },
  {
    what: "a virtual key linking to the policy it routes through",
    drawer: "routingPolicy",
    address: "?drawer.open=routingPolicy&drawer.policyId=policy_1",
    component: "RoutingPolicyDrawer",
    carries: ["policy_1"],
  },
  {
    what: "the automations list opening a row's read-only panel",
    drawer: "viewAutomation",
    address: "?drawer.open=viewAutomation&drawer.automationId=trigger_1",
    component: "ViewAutomationDrawer",
    carries: ["trigger_1"],
  },
];

describe("given an address the product writes", () => {
  for (const opening of OPENINGS) {
    describe(`when it is ${opening.what}`, () => {
      it(`mounts ${opening.drawer}`, async () => {
        const props = await openAddress(opening.address, opening.component);

        if (opening.drawer === "agentWorkflowTargetEditor") {
          expect(agentCalls.getById).toHaveBeenCalledWith({
            id: "agent_1",
            projectId: "project_1",
          });
        }

        for (const carried of opening.carries ?? []) {
          expect(props, `${opening.drawer} did not receive ${carried}`).toContain(carried);
        }
      });
    });
  }
});

/**
 * The two addresses that are minted OUTSIDE the application and cannot be corrected
 * once sent.
 */
describe("given a link the product already sent out", () => {
  describe("when it is an alert email's Edit automation link", () => {
    /** @scenario "An alert email's Edit automation link opens the automation it names" */
    it("opens the automation it names, and says the reader came from an email", async () => {
      const props = await openAddress(
        "?drawer.open=automation&drawer.automationId=trigger_1&drawer.source=email-link",
        "AutomationDrawer",
      );

      expect(JSON.parse(props).automationId).toBe("trigger_1");
      expect(JSON.parse(props).source).toBe("email-link");
    });
  });

  describe("when it names the superseded automation drawer", () => {
    /** @scenario "A link issued before the drawer changed still opens the automation" */
    it("opens the authoring drawer on the automation it names", async () => {
      const props = await openAddress(
        "?drawer.open=editAutomationFilter&drawer.automationId=trigger_1",
        "AutomationDrawer",
      );

      expect(JSON.parse(props).automationId).toBe("trigger_1");
    });
  });

  describe("when it is a monitor's platform link", () => {
    /** @scenario "A monitor's platform link opens the online evaluation it names" */
    it("opens the online evaluation drawer on that monitor", async () => {
      const props = await openAddress(
        "?drawer.open=onlineEvaluation&drawer.monitorId=mon_1",
        "OnlineEvaluationDrawer",
      );

      expect(JSON.parse(props).monitorId).toBe("mon_1");
    });
  });
});

describe("given a drawer that hands `open` straight to a Chakra control", () => {
  /**
   * The five that cannot read the address's own answer. The rest coerce
   * internally (`open !== false && open !== undefined`), which is why the
   * defect was invisible until a drawer that does not was registered.
   */
  const COERCED = [
    { drawer: "agentCodeEditor", component: "AgentCodeEditorDrawer" },
    { drawer: "agentHttpEditor", component: "AgentHttpEditorDrawer" },
    { drawer: "workflowSelector", component: "WorkflowSelectorDrawer" },
    { drawer: "inviteMember", component: "InviteMemberDrawer" },
    { drawer: "createTeam", component: "CreateTeamDrawer" },
  ] as const;

  for (const { drawer, component } of COERCED) {
    describe(`when the address opens ${drawer}`, () => {
      it("is told open is true rather than handed its own name", async () => {
        const props = await openAddress(`?drawer.open=${drawer}`, component);

        expect(JSON.parse(props).open).toBe(true);
      });
    });
  }
});

describe("given a drawer the framework may not let close itself", () => {
  /**
   * A target that calls `closeDrawer` clears the whole navigation stack, which drops
   * the caller with it — `dev/docs/best_practices/drawers.md`.
   */
  const CLOSED_BY_THE_ADAPTER = [
    { drawer: "automation", component: "AutomationDrawer", address: "?drawer.open=automation" },
    {
      drawer: "routingPolicy",
      component: "RoutingPolicyDrawer",
      address: "?drawer.open=routingPolicy",
    },
    { drawer: "foundry", component: "FoundryDrawer", address: "?drawer.open=foundry" },
    // The viewer needs an automation to view — with none, the adapter renders
    // nothing rather than asking the server for an empty id.
    {
      drawer: "viewAutomation",
      component: "ViewAutomationDrawer",
      address: "?drawer.open=viewAutomation&drawer.automationId=trigger_1",
    },
  ] as const;

  for (const { drawer, component, address } of CLOSED_BY_THE_ADAPTER) {
    describe(`when the address opens ${drawer}`, () => {
      /** @scenario "A drawer the framework cannot let close itself is handed the close to call" */
      it("is given the close to call", async () => {
        const props = await openAddress(address, component);

        expect(JSON.parse(props).onClose).toBe("[callback]");
      });
    });
  }
});

/**
 * The one drawer that leads to another drawer.
 */
describe("given the automation viewer's hand-over to the editor", () => {
  describe("when the address opens viewAutomation", () => {
    /** @scenario "The automation viewer hands over to the editor at its registered address" */
    it("is given the edit to call", async () => {
      const props = await openAddress(
        "?drawer.open=viewAutomation&drawer.automationId=trigger_1",
        "ViewAutomationDrawer",
      );

      expect(JSON.parse(props).onEdit).toBe("[callback]");
    });
  });
});
