import type { Logger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import type {
  LiteLLMParams,
  RunParameterValues,
  TargetAdapterData,
} from "@langwatch/scenario-contract";
import type { ScenarioHttpPort } from "./scenario-http.port";

/** The serialized description one agent adapter is built from. */
export type AgentAdapterBuildInput = {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
  parameters?: RunParameterValues;
  httpPort?: ScenarioHttpPort;
  logger?: Logger;
};

/**
 * Builds the adapter that speaks to one agent.
 *
 * A port rather than a direct import of the serialized-adapter registry: a
 * service may not reach into its package's concrete adapters, so the process
 * that holds both supplies the registry.
 */
export abstract class AgentAdapterFactoryPort {
  abstract build(input: AgentAdapterBuildInput): AgentAdapter;
}
