/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AgentTestService, ScenarioApp } from "@langwatch/scenario-server";
import type { SuiteApp } from "@langwatch/suite-server";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createSetupSkillsTrpcRouter } from "../langy/setup-skills-trpc.mount";
import type { createSuiteTrpcRouter } from "../suite/suite-trpc.mount";
import type { createScenarioTrpcRouter } from "./scenario-trpc.mount";

/** The three routers, the two `ctx.app` slices, and the services the doors take. */
export type ComposedScenarioFeature = Readonly<{
  /** `scenarios.*`, `suites.*` and `setupSkills.*`, on the process's own root. */
  routers(mount: ApiTrpcFeatureMount): {
    scenarios: ReturnType<typeof createScenarioTrpcRouter>;
    setupSkills: ReturnType<typeof createSetupSkillsTrpcRouter>;
    suites: ReturnType<typeof createSuiteTrpcRouter>;
  };
  /** For `ctx.app.scenarios`. */
  scenarios: ScenarioApp;
  /**
   * The canonical Scenario service and the tab registry, published for the two
   * packaged REST families that take them directly.
   */
  scenarioService: ScenarioService;
  scenarioTabs: ScenarioTabRegistry;
  /**
   * The canonical Simulation service, published so the run EXPORT can sweep
   * through it.
   */
  simulations: SimulationService;
  /**
   * Runs "Test agent", for the `AgentTestPort` this root wires into the
   * Agent package's own application (`ApiAgentTestAdapter`).
   */
  agentTestService: AgentTestService;
  /** For `ctx.app.suites`. */
  suites: SuiteApp;
}>;
