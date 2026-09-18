/**
 * Streaming event from the LLM. These are `raw` events, i.e. they are directly passed through from
 * the LLM.
 */
export class RunRawModelStreamEvent {
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
/**
 * Streaming events that wrap a `RunItem`. As the agent processes the LLM response, it will generate
 * these events from new messages, tool calls, tool outputs, handoffs, etc.
 */
export class RunItemStreamEvent {
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
/**
 * Event that notifies that there is a new agent running.
 */
export class RunAgentUpdatedStreamEvent {
    agent;
    type = 'agent_updated_stream_event';
    /**
     * @param agent The new agent
     */
    constructor(agent) {
        this.agent = agent;
    }
}
//# sourceMappingURL=events.mjs.map