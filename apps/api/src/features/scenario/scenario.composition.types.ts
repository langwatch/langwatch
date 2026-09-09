/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ScenarioApp } from "@langwatch/scenario-server";
import type { MountableRestApp } from "@langwatch/api/rest";
import type { SuiteApi } from "@langwatch/suite-contract";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";

/** The two `ctx.app` slices and the services the doors take. `scenarios.*`,
 * `suites.*` and `setupSkills.*` are not here: their transports are
 * unconverted. */
export type ComposedScenarioFeature = Readonly<{
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
  /** For `ctx.app.suites`. */
  suites: SuiteApi;
  /**
   * The three suite REST families, bound to this process's project-key door.
   * Routed by the process beside its other declared families.
   */
  suiteRest: readonly MountableRestApp[];
}>;
