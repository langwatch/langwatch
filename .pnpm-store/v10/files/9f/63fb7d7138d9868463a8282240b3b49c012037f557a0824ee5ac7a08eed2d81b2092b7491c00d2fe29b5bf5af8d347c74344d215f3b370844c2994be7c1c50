"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Handoff = void 0;
exports.getTransferMessage = getTransferMessage;
exports.handoff = handoff;
exports.getHandoff = getHandoff;
const errors_1 = require("./errors.js");
const tools_1 = require("./utils/tools.js");
const tools_2 = require("./utils/tools.js");
const context_1 = require("./tracing/context.js");
const logger_1 = __importDefault(require("./logger.js"));
/**
 * Generates the message that will be given as tool output to the model that requested the handoff.
 *
 * @param agent The agent to transfer to
 * @returns The message that will be given as tool output to the model that requested the handoff
 */
function getTransferMessage(agent) {
    return JSON.stringify({ assistant: agent.name });
}
/**
 * The default name of the tool that represents the handoff.
 *
 * @param agent The agent to transfer to
 * @returns The name of the tool that represents the handoff
 */
function defaultHandoffToolName(agent) {
    return `transfer_to_${(0, tools_1.toFunctionToolName)(agent.name)}`;
}
/**
 * Generates the description of the tool that represents the handoff.
 *
 * @param agent The agent to transfer to
 * @returns The description of the tool that represents the handoff
 */
function defaultHandoffToolDescription(agent) {
    return `Handoff to the ${agent.name} agent to handle the request. ${agent.handoffDescription ?? ''}`;
}
class Handoff {
    /**
     * The name of the tool that represents the handoff.
     */
    toolName;
    /**
     * The description of the tool that represents the handoff.
     */
    toolDescription;
    /**
     * The JSON schema for the handoff input. Can be empty if the handoff does not take an input
     */
    inputJsonSchema = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
    };
    /**
     * Whether the input JSON schema is in strict mode. We **strongly** recommend setting this to
     * true, as it increases the likelihood of correct JSON input.
     */
    strictJsonSchema = true;
    /**
     * The function that invokes the handoff. The parameters passed are:
     * 1. The handoff run context
     * 2. The arguments from the LLM, as a JSON string. Empty string if inputJsonSchema is empty.
     *
     * Must return an agent
     */
    onInvokeHandoff;
    /**
     * The name of the agent that is being handed off to.
     */
    agentName;
    /**
     * A function that filters the inputs that are passed to the next agent. By default, the new agent
     * sees the entire conversation history. In some cases, you may want to filter inputs e.g. to
     * remove older inputs, or remove tools from existing inputs.
     *
     * The function will receive the entire conversation hisstory so far, including the input item
     * that triggered the handoff and a tool call output item representing the handoff tool's output.
     *
     * You are free to modify the input history or new items as you see fit. The next agent that runs
     * will receive `handoffInputData.allItems
     */
    inputFilter;
    /**
     * The agent that is being handed off to.
     */
    agent;
    /**
     * Returns a function tool definition that can be used to invoke the handoff.
     */
    getHandoffAsFunctionTool() {
        return {
            type: 'function',
            name: this.toolName,
            description: this.toolDescription,
            parameters: this.inputJsonSchema,
            strict: this.strictJsonSchema,
        };
    }
    isEnabled = async () => true;
    constructor(agent, onInvokeHandoff) {
        this.agentName = agent.name;
        this.onInvokeHandoff = onInvokeHandoff;
        this.toolName = defaultHandoffToolName(agent);
        this.toolDescription = defaultHandoffToolDescription(agent);
        this.agent = agent;
    }
}
exports.Handoff = Handoff;
/**
 * Creates a handoff from an agent. Handoffs are automatically created when you pass an agent
 * into the `handoffs` option of the `Agent` constructor. Alternatively, you can use this function
 * to create a handoff manually, giving you more control over configuration.
 *
 * @template TContext The context of the handoff
 * @template TOutput The output type of the handoff
 * @template TInputType The input type of the handoff
 */
function handoff(agent, config = {}) {
    let parser = undefined;
    const hasOnHandoff = !!config.onHandoff;
    const hasInputType = !!config.inputType;
    const hasBothOrNeitherHandoffAndInputType = hasOnHandoff === hasInputType;
    if (!hasBothOrNeitherHandoffAndInputType) {
        throw new errors_1.UserError('You must provide either both `onHandoff` and `inputType` or neither.');
    }
    async function onInvokeHandoff(context, inputJsonString) {
        if (parser) {
            if (!inputJsonString) {
                (0, context_1.addErrorToCurrentSpan)({
                    message: `Handoff function expected non empty input but got: ${inputJsonString}`,
                    data: {
                        details: `input is empty`,
                    },
                });
                throw new errors_1.ModelBehaviorError('Handoff function expected non empty input');
            }
            try {
                // verify that it's valid input but we don't care about the result
                const parsed = await parser(inputJsonString);
                if (config.onHandoff) {
                    await config.onHandoff(context, parsed);
                }
            }
            catch (error) {
                (0, context_1.addErrorToCurrentSpan)({
                    message: `Invalid JSON provided`,
                    data: {},
                });
                if (!logger_1.default.dontLogToolData) {
                    logger_1.default.error(`Invalid JSON when parsing: ${inputJsonString}. Error: ${error}`);
                }
                throw new errors_1.ModelBehaviorError('Invalid JSON provided');
            }
        }
        else {
            await config.onHandoff?.(context);
        }
        return agent;
    }
    const handoff = new Handoff(agent, onInvokeHandoff);
    if (typeof config.isEnabled === 'function') {
        const predicate = config.isEnabled;
        handoff.isEnabled = async ({ runContext, agent }) => {
            const result = await predicate({ runContext, agent });
            return Boolean(result);
        };
    }
    else if (typeof config.isEnabled === 'boolean') {
        handoff.isEnabled = async () => config.isEnabled;
    }
    if (config.inputType) {
        const result = (0, tools_2.getSchemaAndParserFromInputType)(config.inputType, handoff.toolName);
        handoff.inputJsonSchema = result.schema;
        handoff.strictJsonSchema = true;
        parser = result.parser;
    }
    if (config.toolNameOverride) {
        handoff.toolName = config.toolNameOverride;
    }
    if (config.toolDescriptionOverride) {
        handoff.toolDescription = config.toolDescriptionOverride;
    }
    if (config.inputFilter) {
        handoff.inputFilter = config.inputFilter;
    }
    return handoff;
}
/**
 * Returns a handoff for the given agent. If the agent is already wrapped into a handoff,
 * it will be returned as is. Otherwise, a new handoff instance will be created.
 *
 * @template TContext The context of the handoff
 * @template TOutput The output type of the handoff
 */
function getHandoff(agent) {
    if (agent instanceof Handoff) {
        return agent;
    }
    return handoff(agent);
}
//# sourceMappingURL=handoff.js.map