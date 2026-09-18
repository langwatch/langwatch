import { RunContext } from './runContext';
import type { Agent, AgentOutputType } from './agent';
import { Tool } from './tool';
import { RuntimeEventEmitter, EventEmitter, EventEmitterEvents } from '@openai/agents-core/_shims';
import { AgentInputItem, TextOutput, UnknownContext } from './types';
import * as protocol from './types/protocol';
export declare abstract class EventEmitterDelegate<EventTypes extends EventEmitterEvents = Record<string, any[]>> implements EventEmitter<EventTypes> {
    protected abstract eventEmitter: EventEmitter<EventTypes>;
    on<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
    off<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
    emit<K extends keyof EventTypes>(type: K, ...args: EventTypes[K]): boolean;
    once<K extends keyof EventTypes>(type: K, listener: (...args: EventTypes[K]) => void): EventEmitter<EventTypes>;
}
export type AgentHookEvents<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> = {
    /**
     * @param context - The context of the run
     * @param agent - The agent that is starting
     * @param turnInput - The input items for the current turn
     */
    agent_start: [
        context: RunContext<TContext>,
        agent: Agent<TContext, TOutput>,
        turnInput?: AgentInputItem[]
    ];
    /**
     * Note that the second argument is not consistent with the run hooks here.
     * Changing the list is a breaking change, so we don't make changes for it in the short term
     * If we revisit the argument data structure (e.g., migrating to a single object instead),
     * more properties could be easily added later on.
     *
     * @param context - The context of the run
     * @param output - The output of the agent
     */
    agent_end: [context: RunContext<TContext>, output: string];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is handing off
     * @param nextAgent - The next agent to run
     */
    agent_handoff: [context: RunContext<TContext>, nextAgent: Agent<any, any>];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is starting a tool
     * @param tool - The tool that is starting
     */
    agent_tool_start: [
        context: RunContext<TContext>,
        tool: Tool<any>,
        details: {
            toolCall: protocol.ToolCallItem;
        }
    ];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is ending a tool
     * @param tool - The tool that is ending
     * @param result - The result of the tool
     */
    agent_tool_end: [
        context: RunContext<TContext>,
        tool: Tool<any>,
        result: string,
        details: {
            toolCall: protocol.ToolCallItem;
        }
    ];
};
/**
 * Event emitter that every Agent instance inherits from and that emits events for the lifecycle
 * of the agent.
 */
export declare class AgentHooks<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> extends EventEmitterDelegate<AgentHookEvents<TContext, TOutput>> {
    protected eventEmitter: RuntimeEventEmitter<AgentHookEvents<TContext, TOutput>>;
}
export type RunHookEvents<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> = {
    /**
     * @param context - The context of the run
     * @param agent - The agent that is starting
     */
    agent_start: [
        context: RunContext<TContext>,
        agent: Agent<TContext, TOutput>,
        turnInput?: AgentInputItem[]
    ];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is ending
     * @param output - The output of the agent
     */
    agent_end: [
        context: RunContext<TContext>,
        agent: Agent<TContext, TOutput>,
        output: string
    ];
    /**
     * @param context - The context of the run
     * @param fromAgent - The agent that is handing off
     * @param toAgent - The next agent to run
     */
    agent_handoff: [
        context: RunContext<TContext>,
        fromAgent: Agent<any, any>,
        toAgent: Agent<any, any>
    ];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is starting a tool
     * @param tool - The tool that is starting
     */
    agent_tool_start: [
        context: RunContext<TContext>,
        agent: Agent<TContext, TOutput>,
        tool: Tool,
        details: {
            toolCall: protocol.ToolCallItem;
        }
    ];
    /**
     * @param context - The context of the run
     * @param agent - The agent that is ending a tool
     * @param tool - The tool that is ending
     * @param result - The result of the tool
     */
    agent_tool_end: [
        context: RunContext<TContext>,
        agent: Agent<TContext, TOutput>,
        tool: Tool,
        result: string,
        details: {
            toolCall: protocol.ToolCallItem;
        }
    ];
};
/**
 * Event emitter that every Runner instance inherits from and that emits events for the lifecycle
 * of the overall run.
 */
export declare class RunHooks<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> extends EventEmitterDelegate<RunHookEvents<TContext, TOutput>> {
    protected eventEmitter: RuntimeEventEmitter<RunHookEvents<TContext, TOutput>>;
}
