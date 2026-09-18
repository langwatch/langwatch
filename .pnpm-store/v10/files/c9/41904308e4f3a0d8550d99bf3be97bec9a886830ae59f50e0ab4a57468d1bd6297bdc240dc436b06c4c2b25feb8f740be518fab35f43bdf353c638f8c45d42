import { Agent } from '../agent';
import { Model, ModelSettings } from '../model';
import { AgentToolUseTracker } from './toolUseTracker';
/**
 * Resolves the effective model for the next turn by giving precedence to the agent-specific
 * configuration when present, otherwise falling back to the runner-level default.
 */
export declare function selectModel(agentModel: string | Model, runConfigModel: string | Model | undefined): string | Model;
/**
 * Resets the tool choice when the agent is configured to prefer a fresh tool selection after
 * any tool usage. This prevents the provider from reusing stale tool hints across turns.
 */
export declare function maybeResetToolChoice(agent: Agent<any, any>, toolUseTracker: AgentToolUseTracker, modelSettings: ModelSettings): ModelSettings;
/**
 * When the default model is a GPT-5 variant, agents may carry GPT-5-specific providerData
 * (e.g., reasoning effort, text verbosity). If a run resolves to a non-GPT-5 model and the
 * agent relied on the default model (i.e., no explicit model set), these GPT-5-only settings
 * are incompatible and should be stripped to avoid runtime errors.
 */
export declare function adjustModelSettingsForNonGPT5RunnerModel(explictlyModelSet: boolean, agentModelSettings: ModelSettings, runnerModel: string | Model, modelSettings: ModelSettings, resolvedModelName?: string): ModelSettings;
