"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunAgentUpdatedStreamEvent = exports.RunItemStreamEvent = exports.RunRawModelStreamEvent = void 0;
/**
 * Streaming event from the LLM. These are `raw` events, i.e. they are directly passed through from
 * the LLM.
 */
class RunRawModelStreamEvent {
    data;
    /**
     * The type of the event.
     */
    type = 'raw_model_stream_event';
    /**
     * @param data The raw responses stream events from the LLM.
     */
    constructor(data) {
        this.data = data;
    }
}
exports.RunRawModelStreamEvent = RunRawModelStreamEvent;
/**
 * Streaming events that wrap a `RunItem`. As the agent processes the LLM response, it will generate
 * these events from new messages, tool calls, tool outputs, handoffs, etc.
 */
class RunItemStreamEvent {
    name;
    item;
    type = 'run_item_stream_event';
    /**
     * @param name The name of the event.
     * @param item The item that was created.
     */
    constructor(name, item) {
        this.name = name;
        this.item = item;
    }
}
exports.RunItemStreamEvent = RunItemStreamEvent;
/**
 * Event that notifies that there is a new agent running.
 */
class RunAgentUpdatedStreamEvent {
    agent;
    type = 'agent_updated_stream_event';
    /**
     * @param agent The new agent
     */
    constructor(agent) {
        this.agent = agent;
    }
}
exports.RunAgentUpdatedStreamEvent = RunAgentUpdatedStreamEvent;
//# sourceMappingURL=events.js.map