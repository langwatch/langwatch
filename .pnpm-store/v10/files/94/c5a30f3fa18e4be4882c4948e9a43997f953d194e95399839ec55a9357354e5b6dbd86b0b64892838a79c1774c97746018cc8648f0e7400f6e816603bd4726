import { Agent, AgentOutputType } from '../agent';
import { RunState } from '../runState';
import { AgentArtifacts } from './types';
/**
 * Collects tools and handoffs for the current agent so model calls and tracing share the same
 * snapshot of enabled capabilities.
 */
export declare function prepareAgentArtifacts<TContext, TAgent extends Agent<TContext, AgentOutputType>>(state: RunState<TContext, TAgent>): Promise<AgentArtifacts<TContext>>;
