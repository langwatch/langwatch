/**
 * @vitest-environment jsdom
 *
 * The addresses the product writes, driven through the real registry.
 *
 * THE FAILURE THIS FILE EXISTS FOR IS SILENT. `CurrentDrawer` looks
 * `?drawer.open=<name>` up in the composed registry, misses, and renders null —
 * no error, no toast, no log line. The reader clicks and the page does not
 * move. That is how twenty-two names ended up addressed and unregistered after
 * `platform/app` was deleted, and it is why `installed-ui-drawers.unit.test.ts`
 * (which counts the composition) cannot be the whole guard: a name can be in
 * the registry and still open nothing, because the module path is wrong, the
 * export key is misspelled, or the component is handed props it cannot use.
 *
 * SO THIS DRIVES THE WHOLE PATH A CALL SITE DOES: the exact query string some
 * screen, command-bar entry or outbound EMAIL writes, into the real
 * `installedUiDrawers`, through the lazy import and the application's own
 * adapter, and asserts the component on the other side was mounted with what
 * the address carried.
 *
 * WHAT IS MOCKED IS EACH FAMILY'S PACKAGE ENTRY AND ITS HOST PROVIDER, in the
 * shape `chrome-drawer.integration.test.tsx` mocks the registry: a stub in the
 * package's place keeps the assertion on the wiring rather than on one
 * family's tRPC provider, and a pass-through host keeps it out of eight
 * different transports. A stub only answers to the export name the registry
 * asks for, so a misspelled `key` still fails here — which is the point.
 *
 * `open` IS ASSERTED AS A BOOLEAN wherever the drawer hands it to Chakra.
 * `CurrentDrawer` spreads the PARSED ADDRESS, so `open` arrives as the drawer
 * NAME; a control that takes only a boolean renders closed against an address
 * that says it is open, which is the defect `agent-drawers.tsx` recorded when
 * the type selector moved.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { CurrentDrawer } from "@langwatch/ui-drawer";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * One stub module, from the export names the registry asks it for.
 *
 * Each component prints its own name and its props, so an assertion can read
 * both what was mounted and what the address handed it. Functions are printed
 * by name rather than by body: what matters about `onClose` is that one
 * arrived.
 */
const stub = vi.hoisted(() => {
  const drawers = async (names: readonly string[]): Promise<Record<string, unknown>> => {
    const { createElement } = await import("react");
    const module: Record<string, unknown> = {};
    for (const name of names) {
      module[name] = (props: Record<string, unknown>) =>
        createElement(
          "div",
          { "data-testid": `drawer-${name}` },
          JSON.stringify(props, (_key, value) =>
            typeof value === "function" ? "[callback]" : value,
          ),
        );
    }
    return module;
  };
  return { drawers };
});

vi.mock("@langwatch/scenario-web/drawers", () =>
  stub.drawers([
    "AgentCodeEditorDrawerFromUrl",
    "AgentHttpEditorDrawerFromUrl",
    "WorkflowSelectorDrawerFromUrl",
    "AgentListDrawer",
    "AgentWorkflowTargetEditorDrawer",
    "AgentTestingPlanEditorDrawer",
    "ScenarioRunDetailDrawer",
    "ScenarioFormDrawerFromUrl",
    "SuiteFormDrawer",
    "AgentWorkflowEditorDrawer",
    "ScenarioVersionHistoryDrawer",
  ]),
);

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
vi.mock("@langwatch/dataset-web/components/AddOrEditDatasetDrawer", () =>
  stub.drawers(["AddOrEditDatasetDrawer"]),
);
vi.mock("@langwatch/dataset-web/components/datasets/UploadCSVDrawer", () =>
  stub.drawers(["UploadCSVDrawer"]),
);
vi.mock("@langwatch/prompt-web/components/prompts/PromptEditorDrawer", () =>
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
 *
 * One factory rather than seven, because a module only takes the names it
 * imports and the extras are ignored. What this stubs out is eight tRPC
 * providers and eight organization-graph reads; what each page-policy suite
 * already proves for its own family is that the real wrapper mounts.
 */
const passThroughHost = vi.hoisted(
  () => () =>
    ({
      withScenarioHost: <P,>(Component: P) => Component,
      withScenarioDrawerHost: <P,>(Component: P) => Component,
      withWorkflowHost: <P,>(Component: P) => Component,
      withOrganizationHost: <P,>(Component: P) => Component,
      withOpsHost: <P,>(Component: P) => Component,
      withGatewayHost: <P,>(Component: P) => Component,
      withAutomationsHost: <P,>(Component: P) => Component,
    }) as Record<string, unknown>,
);

vi.mock("../src/features/simulations/ui/sections/host-provider", passThroughHost);
vi.mock("../src/features/workflows/ui/sections/workflows-host-provider", passThroughHost);
vi.mock("../src/features/organization/ui/sections/organization-host-provider", passThroughHost);
vi.mock("../src/features/ops/ui/sections/ops-host-provider", passThroughHost);
vi.mock("../src/features/gateway/ui/sections/gateway-host-provider", passThroughHost);
vi.mock("../src/features/automations/ui/sections/automations-host-provider", passThroughHost);

import { installedUiDrawers } from "../src/features/installed-ui-drawers";

// This package runs without vitest globals, so testing-library never registers
// its own auto-cleanup: without this one case's drawer is still in the document
// when the next one looks for it.
afterEach(() => cleanup());

async function openAddress(address: string, component: string): Promise<string> {
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
 *
 * Every one is copied from a live call site rather than invented: the two email
 * links are the strings `template-context.ts` and `monitor.api.ts` mint, and the
 * rest are what a screen, a host adapter or the command palette passes to
 * `openDrawer`.
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
    component: "AgentCodeEditorDrawerFromUrl",
  },
  {
    what: "the agent type selector picking an HTTP agent",
    drawer: "agentHttpEditor",
    address: "?drawer.open=agentHttpEditor",
    component: "AgentHttpEditorDrawerFromUrl",
  },
  {
    what: "the agent type selector picking a workflow agent",
    drawer: "workflowSelector",
    address: "?drawer.open=workflowSelector",
    component: "WorkflowSelectorDrawerFromUrl",
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
    carries: ["agent_1"],
  },
  {
    what: "Agent Testing editing a suite's run plan",
    drawer: "agentTestingPlanEditor",
    address: "?drawer.open=agentTestingPlanEditor&drawer.suiteId=suite_1",
    component: "AgentTestingPlanEditorDrawer",
    carries: ["suite_1"],
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

        for (const carried of opening.carries ?? []) {
          expect(props, `${opening.drawer} did not receive ${carried}`).toContain(carried);
        }
      });
    });
  }
});

/**
 * The two addresses that are minted OUTSIDE the application and cannot be
 * corrected once sent.
 *
 * `packages/features/automation/contract/src/templating/template-context.ts`
 * puts the first into every alert email as `trigger.editUrl`, and
 * `packages/features/monitor/server/src/transport/api-rest/monitor.api.ts` puts
 * the second into every monitor the REST API answers with, as `platformUrl`.
 * Both are copied here literally: what is under test is that the name each
 * already writes resolves, which is the only side of this that can still be
 * fixed.
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
    { drawer: "agentCodeEditor", component: "AgentCodeEditorDrawerFromUrl" },
    { drawer: "agentHttpEditor", component: "AgentHttpEditorDrawerFromUrl" },
    { drawer: "workflowSelector", component: "WorkflowSelectorDrawerFromUrl" },
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
   * A target that calls `closeDrawer` clears the whole navigation stack, which
   * drops the caller with it — `dev/docs/best_practices/drawers.md`. These
   * three take the close as a prop for that reason, so the application's
   * adapter is what has to supply one; without it the drawer opens and cannot
   * be shut.
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
 *
 * "Edit" on the read-only panel is a drawer NAVIGATING to a drawer, which the
 * drawers doc says goes through `openDrawer` rather than through a second
 * mount. The panel cannot make that call itself — it is a package component and
 * the registry is composition — so the adapter hands it the hand-over, and a
 * missing one is a dead button rather than an error.
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
