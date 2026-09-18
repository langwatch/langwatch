import { Agent } from '../agent';
import { Handoff } from '../handoff';
import { ModelResponse } from '../model';
import { Tool } from '../tool';
import type { ProcessedResponse } from './types';
/**
 * Walks a raw model response and classifies each item so the runner can schedule follow-up work.
 * Returns both the serializable RunItems (for history/streaming) and the actionable tool metadata.
 */
export declare function processModelResponse<TContext>(modelResponse: ModelResponse, agent: Agent<any, any>, tools: Tool<TContext>[], handoffs: Handoff<any, any>[]): ProcessedResponse<TContext>;
