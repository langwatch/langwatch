/**
 * Adapter factory interfaces for Open/Closed Principle compliance.
 *
 * New target types can be added by implementing TargetAdapterFactory
 * and registering with the registry - no modification of existing code.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import type { LiteLLMParams, TargetConfig } from "../execution/types";

/** Context needed by adapter factories to create adapters */
export interface AdapterCreationContext {
  projectId: string;
  target: TargetConfig;
  modelParams: LiteLLMParams;
  nlpServiceUrl: string;
}

/** Result of adapter creation - success with adapter or failure with error */
export type AdapterResult =
  | { success: true; adapter: AgentAdapter }
  | { success: false; error: string };

/**
 * Factory interface for creating target adapters.
 *
 * Each target type (prompt, http, workflow, etc.) has its own factory.
 * Factories are registered with TargetAdapterRegistry for OCP compliance.
 */
export interface TargetAdapterFactory {
  /** Returns true if this factory handles the given target type */
  supports(type: string): boolean;

  /** Creates an adapter for the target */
  create(context: AdapterCreationContext): Promise<AdapterResult>;
}
