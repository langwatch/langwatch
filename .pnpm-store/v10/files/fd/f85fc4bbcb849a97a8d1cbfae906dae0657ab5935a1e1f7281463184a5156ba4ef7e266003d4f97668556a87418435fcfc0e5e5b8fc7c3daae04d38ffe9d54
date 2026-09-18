"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToolCallOutputItem = getToolCallOutputItem;
exports.executeFunctionToolCalls = executeFunctionToolCalls;
exports.executeShellActions = executeShellActions;
exports.executeApplyPatchOperations = executeApplyPatchOperations;
exports.executeComputerActions = executeComputerActions;
exports.executeHandoffCalls = executeHandoffCalls;
exports.collectInterruptions = collectInterruptions;
exports.checkForFinalOutputFromTools = checkForFinalOutputFromTools;
const agent_1 = require("../agent.js");
const errors_1 = require("../errors.js");
const handoff_1 = require("../handoff.js");
const items_1 = require("../items.js");
const logger_1 = __importDefault(require("../logger.js"));
const tool_1 = require("../tool.js");
const base64_1 = require("../utils/base64.js");
const smartString_1 = require("../utils/smartString.js");
const utils_1 = require("../utils/index.js");
const createSpans_1 = require("../tracing/createSpans.js");
const toolGuardrails_1 = require("../utils/toolGuardrails.js");
const steps_1 = require("./steps.js");
const TOOL_APPROVAL_REJECTION_MESSAGE = 'Tool execution was not approved.';
/**
 * @internal
 * Normalizes tool outputs once so downstream code works with fully structured protocol items.
 * Doing this here keeps API surface stable even when providers add new shapes.
 */
function getToolCallOutputItem(toolCall, output) {
    const maybeStructuredOutputs = normalizeStructuredToolOutputs(output);
    if (maybeStructuredOutputs) {
        const structuredItems = maybeStructuredOutputs.map(convertStructuredToolOutputToInputItem);
        return {
            type: 'function_call_result',
            name: toolCall.name,
            callId: toolCall.callId,
            status: 'completed',
            output: structuredItems,
        };
    }
    return {
        type: 'function_call_result',
        name: toolCall.name,
        callId: toolCall.callId,
        status: 'completed',
        output: {
            type: 'text',
            text: (0, smartString_1.toSmartString)(output),
        },
    };
}
/**
 * @internal
 * Runs every function tool call requested by the model and returns their outputs alongside
 * the `RunItem` instances that should be appended to history.
 */
async function executeFunctionToolCalls(agent, toolRuns, runner, state) {
    const deps = { agent, runner, state };
    try {
        const results = await Promise.all(toolRuns.map(async (toolRun) => {
            const parsedArgs = parseToolArguments(toolRun);
            const approvalOutcome = await handleFunctionApproval(deps, toolRun, parsedArgs);
            if (approvalOutcome !== 'approved') {
                return approvalOutcome;
            }
            return runApprovedFunctionTool(deps, toolRun);
        }));
        return results;
    }
    catch (e) {
        throw new errors_1.ToolCallError(`Failed to run function tools: ${e}`, e, state);
    }
}
function parseToolArguments(toolRun) {
    let parsedArgs = toolRun.toolCall.arguments;
    if (toolRun.tool.parameters) {
        if ((0, utils_1.isZodObject)(toolRun.tool.parameters)) {
            parsedArgs = toolRun.tool.parameters.parse(parsedArgs);
        }
        else {
            parsedArgs = JSON.parse(parsedArgs);
        }
    }
    return parsedArgs;
}
function buildApprovalRequestResult(deps, toolRun) {
    return {
        type: 'function_approval',
        tool: toolRun.tool,
        runItem: new items_1.RunToolApprovalItem(toolRun.toolCall, deps.agent),
    };
}
async function buildApprovalRejectionResult(deps, toolRun) {
    const { agent } = deps;
    return (0, createSpans_1.withFunctionSpan)(async (span) => {
        const response = 'Tool execution was not approved.';
        span.setError({
            message: response,
            data: {
                tool_name: toolRun.tool.name,
                error: `Tool execution for ${toolRun.toolCall.callId} was manually rejected by user.`,
            },
        });
        span.spanData.output = response;
        return {
            type: 'function_output',
            tool: toolRun.tool,
            output: response,
            runItem: new items_1.RunToolCallOutputItem(getToolCallOutputItem(toolRun.toolCall, response), agent, response),
        };
    }, {
        data: {
            name: toolRun.tool.name,
        },
    });
}
async function handleFunctionApproval(deps, toolRun, parsedArgs) {
    const { state } = deps;
    const needsApproval = await toolRun.tool.needsApproval(state._context, parsedArgs, toolRun.toolCall.callId);
    if (!needsApproval) {
        return 'approved';
    }
    const approval = state._context.isToolApproved({
        toolName: toolRun.tool.name,
        callId: toolRun.toolCall.callId,
    });
    if (approval === false) {
        return await buildApprovalRejectionResult(deps, toolRun);
    }
    if (approval !== true) {
        return buildApprovalRequestResult(deps, toolRun);
    }
    return 'approved';
}
async function runApprovedFunctionTool(deps, toolRun) {
    const { agent, runner, state } = deps;
    return (0, createSpans_1.withFunctionSpan)(async (span) => {
        if (runner.config.traceIncludeSensitiveData) {
            span.spanData.input = toolRun.toolCall.arguments;
        }
        try {
            const inputGuardrailResult = await (0, toolGuardrails_1.runToolInputGuardrails)({
                guardrails: toolRun.tool.inputGuardrails,
                context: state._context,
                agent,
                toolCall: toolRun.toolCall,
                onResult: (result) => {
                    state._toolInputGuardrailResults.push(result);
                },
            });
            emitToolStart(runner, state._context, agent, toolRun.tool, toolRun.toolCall);
            let toolOutput;
            if (inputGuardrailResult.type === 'reject') {
                toolOutput = inputGuardrailResult.message;
            }
            else {
                toolOutput = await toolRun.tool.invoke(state._context, toolRun.toolCall.arguments, { toolCall: toolRun.toolCall });
                toolOutput = await (0, toolGuardrails_1.runToolOutputGuardrails)({
                    guardrails: toolRun.tool.outputGuardrails,
                    context: state._context,
                    agent,
                    toolCall: toolRun.toolCall,
                    toolOutput,
                    onResult: (result) => {
                        state._toolOutputGuardrailResults.push(result);
                    },
                });
            }
            const stringResult = (0, smartString_1.toSmartString)(toolOutput);
            emitToolEnd(runner, state._context, agent, toolRun.tool, stringResult, toolRun.toolCall);
            if (runner.config.traceIncludeSensitiveData) {
                span.spanData.output = stringResult;
            }
            const functionResult = {
                type: 'function_output',
                tool: toolRun.tool,
                output: toolOutput,
                runItem: new items_1.RunToolCallOutputItem(getToolCallOutputItem(toolRun.toolCall, toolOutput), agent, toolOutput),
            };
            const nestedRunResult = (0, agent_1.consumeAgentToolRunResult)(toolRun.toolCall);
            if (nestedRunResult) {
                functionResult.agentRunResult = nestedRunResult;
                const nestedInterruptions = nestedRunResult.interruptions;
                if (nestedInterruptions.length > 0) {
                    functionResult.interruptions = nestedInterruptions;
                }
            }
            return functionResult;
        }
        catch (error) {
            span.setError({
                message: 'Error running tool',
                data: {
                    tool_name: toolRun.tool.name,
                    error: String(error),
                },
            });
            const errorResult = String(error);
            emitToolEnd(runner, state._context, agent, toolRun.tool, errorResult, toolRun.toolCall);
            throw error;
        }
    }, {
        data: {
            name: toolRun.tool.name,
        },
    });
}
/**
 * @internal
 */
// Internal helper: dispatch a computer action and return a screenshot (sync/async)
async function _runComputerActionAndScreenshot(computer, toolCall) {
    const action = toolCall.action;
    let screenshot;
    // Dispatch based on action type string (assume action.type exists)
    switch (action.type) {
        case 'click':
            await computer.click(action.x, action.y, action.button);
            break;
        case 'double_click':
            await computer.doubleClick(action.x, action.y);
            break;
        case 'drag':
            await computer.drag(action.path.map((p) => [p.x, p.y]));
            break;
        case 'keypress':
            await computer.keypress(action.keys);
            break;
        case 'move':
            await computer.move(action.x, action.y);
            break;
        case 'screenshot':
            screenshot = await computer.screenshot();
            break;
        case 'scroll':
            await computer.scroll(action.x, action.y, action.scroll_x, action.scroll_y);
            break;
        case 'type':
            await computer.type(action.text);
            break;
        case 'wait':
            await computer.wait();
            break;
        default:
            action; // ensures that we handle every action we know of
            // Unknown action, just take screenshot
            break;
    }
    if (typeof screenshot !== 'undefined') {
        return screenshot;
    }
    // Always return screenshot as base64 string
    if (typeof computer.screenshot === 'function') {
        screenshot = await computer.screenshot();
        if (typeof screenshot !== 'undefined') {
            return screenshot;
        }
    }
    throw new Error('Computer does not implement screenshot()');
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message || error.toString();
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
async function resolveToolApproval(options) {
    const { runContext, toolName, callId, approvalItem, needsApproval, onApproval, } = options;
    if (!needsApproval) {
        return 'approved';
    }
    if (onApproval) {
        const decision = await onApproval(runContext, approvalItem);
        if (decision.approve === true) {
            runContext.approveTool(approvalItem);
        }
        else if (decision.approve === false) {
            runContext.rejectTool(approvalItem);
        }
    }
    const approval = runContext.isToolApproved({
        toolName,
        callId,
    });
    if (approval === true) {
        return 'approved';
    }
    if (approval === false) {
        return 'rejected';
    }
    return 'pending';
}
async function handleToolApprovalDecision(options) {
    const { runContext, toolName, callId, approvalItem, needsApproval, onApproval, buildRejectionItem, } = options;
    const approvalState = await resolveToolApproval({
        runContext,
        toolName,
        callId,
        approvalItem,
        needsApproval,
        onApproval,
    });
    if (approvalState === 'rejected') {
        return { status: 'rejected', item: buildRejectionItem() };
    }
    if (approvalState === 'pending') {
        return { status: 'pending', item: approvalItem };
    }
    return { status: 'approved' };
}
function emitToolStart(runner, runContext, agent, tool, toolCall) {
    runner.emit('agent_tool_start', runContext, agent, tool, { toolCall });
    if (typeof agent.emit === 'function') {
        agent.emit('agent_tool_start', runContext, tool, { toolCall });
    }
}
function emitToolEnd(runner, runContext, agent, tool, output, toolCall) {
    runner.emit('agent_tool_end', runContext, agent, tool, output, { toolCall });
    if (typeof agent.emit === 'function') {
        agent.emit('agent_tool_end', runContext, tool, output, { toolCall });
    }
}
async function executeShellActions(agent, actions, runner, runContext, customLogger = undefined) {
    const _logger = customLogger ?? logger_1.default;
    const results = [];
    for (const action of actions) {
        const shellTool = action.shell;
        const toolCall = action.toolCall;
        const approvalItem = new items_1.RunToolApprovalItem(toolCall, agent, shellTool.name);
        const approvalDecision = await handleToolApprovalDecision({
            runContext,
            toolName: shellTool.name,
            callId: toolCall.callId,
            approvalItem,
            needsApproval: await shellTool.needsApproval(runContext, toolCall.action, toolCall.callId),
            onApproval: shellTool.onApproval,
            buildRejectionItem: () => {
                const response = TOOL_APPROVAL_REJECTION_MESSAGE;
                const rejectionOutput = {
                    stdout: '',
                    stderr: response,
                    outcome: { type: 'exit', exitCode: null },
                };
                return new items_1.RunToolCallOutputItem({
                    type: 'shell_call_output',
                    callId: toolCall.callId,
                    output: [rejectionOutput],
                }, agent, response);
            },
        });
        if (approvalDecision.status !== 'approved') {
            results.push(approvalDecision.item);
            continue;
        }
        emitToolStart(runner, runContext, agent, shellTool, toolCall);
        let shellOutputs;
        const providerMeta = {};
        let maxOutputLength;
        try {
            const shellResult = await shellTool.shell.run(toolCall.action);
            shellOutputs = shellResult.output ?? [];
            if (shellResult.providerData) {
                Object.assign(providerMeta, shellResult.providerData);
            }
            if (typeof shellResult.maxOutputLength === 'number') {
                maxOutputLength = shellResult.maxOutputLength;
            }
        }
        catch (err) {
            const errorText = toErrorMessage(err);
            shellOutputs = [
                {
                    stdout: '',
                    stderr: errorText,
                    outcome: { type: 'exit', exitCode: null },
                },
            ];
            _logger.error('Failed to execute shell action:', err);
        }
        shellOutputs = shellOutputs ?? [];
        emitToolEnd(runner, runContext, agent, shellTool, JSON.stringify(shellOutputs), toolCall);
        const rawItem = {
            type: 'shell_call_output',
            callId: toolCall.callId,
            output: shellOutputs ?? [],
        };
        if (typeof maxOutputLength === 'number') {
            rawItem.maxOutputLength = maxOutputLength;
        }
        if (Object.keys(providerMeta).length > 0) {
            rawItem.providerData = providerMeta;
        }
        results.push(new items_1.RunToolCallOutputItem(rawItem, agent, rawItem.output));
    }
    return results;
}
async function executeApplyPatchOperations(agent, actions, runner, runContext, customLogger = undefined) {
    const _logger = customLogger ?? logger_1.default;
    const results = [];
    for (const action of actions) {
        const applyPatchTool = action.applyPatch;
        const toolCall = action.toolCall;
        const approvalItem = new items_1.RunToolApprovalItem(toolCall, agent, applyPatchTool.name);
        const approvalDecision = await handleToolApprovalDecision({
            runContext,
            toolName: applyPatchTool.name,
            callId: toolCall.callId,
            approvalItem,
            needsApproval: await applyPatchTool.needsApproval(runContext, toolCall.operation, toolCall.callId),
            onApproval: applyPatchTool.onApproval,
            buildRejectionItem: () => {
                const response = TOOL_APPROVAL_REJECTION_MESSAGE;
                return new items_1.RunToolCallOutputItem({
                    type: 'apply_patch_call_output',
                    callId: toolCall.callId,
                    status: 'failed',
                    output: response,
                }, agent, response);
            },
        });
        if (approvalDecision.status !== 'approved') {
            results.push(approvalDecision.item);
            continue;
        }
        emitToolStart(runner, runContext, agent, applyPatchTool, toolCall);
        let status = 'completed';
        let output = '';
        try {
            let result;
            switch (toolCall.operation.type) {
                case 'create_file':
                    result = await applyPatchTool.editor.createFile(toolCall.operation);
                    break;
                case 'update_file':
                    result = await applyPatchTool.editor.updateFile(toolCall.operation);
                    break;
                case 'delete_file':
                    result = await applyPatchTool.editor.deleteFile(toolCall.operation);
                    break;
                default:
                    throw new Error('Unsupported apply_patch operation');
            }
            if (result && typeof result.status === 'string') {
                status = result.status;
            }
            if (result && typeof result.output === 'string') {
                output = result.output;
            }
        }
        catch (err) {
            status = 'failed';
            output = toErrorMessage(err);
            _logger.error('Failed to execute apply_patch operation:', err);
        }
        emitToolEnd(runner, runContext, agent, applyPatchTool, output, toolCall);
        const rawItem = {
            type: 'apply_patch_call_output',
            callId: toolCall.callId,
            status,
        };
        if (output) {
            rawItem.output = output;
        }
        results.push(new items_1.RunToolCallOutputItem(rawItem, agent, output));
    }
    return results;
}
/**
 * @internal
 * Executes any computer-use actions emitted by the model and returns the resulting items so
 * the run history reflects the computer session.
 */
async function executeComputerActions(agent, actions, runner, runContext, customLogger = undefined) {
    const _logger = customLogger ?? logger_1.default;
    const results = [];
    for (const action of actions) {
        const toolCall = action.toolCall;
        // Hooks: on_tool_start (global + agent)
        emitToolStart(runner, runContext, agent, action.computer, toolCall);
        // Run the action and get screenshot
        let output;
        try {
            const computer = await (0, tool_1.resolveComputer)({
                tool: action.computer,
                runContext,
            });
            output = await _runComputerActionAndScreenshot(computer, toolCall);
        }
        catch (err) {
            _logger.error('Failed to execute computer action:', err);
            output = '';
        }
        // Hooks: on_tool_end (global + agent)
        emitToolEnd(runner, runContext, agent, action.computer, output, toolCall);
        // Return the screenshot as a data URL when available; fall back to an empty string on failures.
        const imageUrl = output ? `data:image/png;base64,${output}` : '';
        const rawItem = {
            type: 'computer_call_result',
            callId: toolCall.callId,
            output: { type: 'computer_screenshot', data: imageUrl },
        };
        results.push(new items_1.RunToolCallOutputItem(rawItem, agent, imageUrl));
    }
    return results;
}
/**
 * @internal
 * Drives handoff calls by invoking the downstream agent and capturing any generated items so
 * the current agent can continue with the new context.
 */
async function executeHandoffCalls(agent, originalInput, preStepItems, newStepItems, newResponse, runHandoffs, runner, runContext) {
    newStepItems = [...newStepItems];
    if (runHandoffs.length === 0) {
        logger_1.default.warn('Incorrectly called executeHandoffCalls with no handoffs. This should not happen. Moving on.');
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newStepItems, { type: 'next_step_run_again' });
    }
    if (runHandoffs.length > 1) {
        // multiple handoffs. Ignoring all but the first one by adding reject responses for those
        const outputMessage = 'Multiple handoffs detected, ignoring this one.';
        for (let i = 1; i < runHandoffs.length; i++) {
            newStepItems.push(new items_1.RunToolCallOutputItem(getToolCallOutputItem(runHandoffs[i].toolCall, outputMessage), agent, outputMessage));
        }
    }
    const actualHandoff = runHandoffs[0];
    return (0, createSpans_1.withHandoffSpan)(async (handoffSpan) => {
        const handoff = actualHandoff.handoff;
        const newAgent = await handoff.onInvokeHandoff(runContext, actualHandoff.toolCall.arguments);
        handoffSpan.spanData.to_agent = newAgent.name;
        if (runHandoffs.length > 1) {
            const requestedAgents = runHandoffs.map((h) => h.handoff.agentName);
            handoffSpan.setError({
                message: 'Multiple handoffs requested',
                data: {
                    requested_agents: requestedAgents,
                },
            });
        }
        newStepItems.push(new items_1.RunHandoffOutputItem(getToolCallOutputItem(actualHandoff.toolCall, (0, handoff_1.getTransferMessage)(newAgent)), agent, newAgent));
        runner.emit('agent_handoff', runContext, agent, newAgent);
        agent.emit('agent_handoff', runContext, newAgent);
        const inputFilter = handoff.inputFilter ?? runner.config.handoffInputFilter;
        if (inputFilter) {
            logger_1.default.debug('Filtering inputs for handoff');
            if (typeof inputFilter !== 'function') {
                handoffSpan.setError({
                    message: 'Invalid input filter',
                    data: {
                        details: 'not callable',
                    },
                });
            }
            const handoffInputData = {
                inputHistory: Array.isArray(originalInput)
                    ? [...originalInput]
                    : originalInput,
                preHandoffItems: [...preStepItems],
                newItems: [...newStepItems],
                runContext,
            };
            const filtered = inputFilter(handoffInputData);
            originalInput = filtered.inputHistory;
            preStepItems = filtered.preHandoffItems;
            newStepItems = filtered.newItems;
        }
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newStepItems, { type: 'next_step_handoff', newAgent });
    }, {
        data: {
            from_agent: agent.name,
        },
    });
}
const NOT_FINAL_OUTPUT = {
    isFinalOutput: false,
    isInterrupted: undefined,
};
/**
 * Collects approval interruptions from tool execution results and any additional
 * RunItems (e.g., shell/apply_patch approval placeholders).
 */
function collectInterruptions(toolResults, additionalItems = []) {
    const interruptions = [];
    for (const item of additionalItems) {
        if (item instanceof items_1.RunToolApprovalItem) {
            interruptions.push(item);
        }
    }
    for (const result of toolResults) {
        if (result.runItem instanceof items_1.RunToolApprovalItem) {
            interruptions.push(result.runItem);
        }
        if (result.type === 'function_output') {
            if (Array.isArray(result.interruptions)) {
                interruptions.push(...result.interruptions);
            }
            else if (result.agentRunResult) {
                const nestedInterruptions = result.agentRunResult.interruptions;
                if (nestedInterruptions.length > 0) {
                    interruptions.push(...nestedInterruptions);
                }
            }
        }
    }
    return interruptions;
}
/**
 * @internal
 * Determines whether tool executions produced a final agent output, triggered an interruption,
 * or whether the agent loop should continue collecting more responses.
 */
async function checkForFinalOutputFromTools(agent, toolResults, state, additionalInterruptions = []) {
    if (toolResults.length === 0 && additionalInterruptions.length === 0) {
        return NOT_FINAL_OUTPUT;
    }
    const interruptions = collectInterruptions(toolResults, additionalInterruptions);
    if (interruptions.length > 0) {
        return {
            isFinalOutput: false,
            isInterrupted: true,
            interruptions,
        };
    }
    if (agent.toolUseBehavior === 'run_llm_again') {
        return NOT_FINAL_OUTPUT;
    }
    const firstToolResult = toolResults[0];
    if (agent.toolUseBehavior === 'stop_on_first_tool') {
        if (firstToolResult?.type === 'function_output') {
            const stringOutput = (0, smartString_1.toSmartString)(firstToolResult.output);
            return {
                isFinalOutput: true,
                isInterrupted: undefined,
                finalOutput: stringOutput,
            };
        }
        return NOT_FINAL_OUTPUT;
    }
    const toolUseBehavior = agent.toolUseBehavior;
    if (typeof toolUseBehavior === 'object') {
        const stoppingTool = toolResults.find((r) => toolUseBehavior.stopAtToolNames.includes(r.tool.name));
        if (stoppingTool?.type === 'function_output') {
            const stringOutput = (0, smartString_1.toSmartString)(stoppingTool.output);
            return {
                isFinalOutput: true,
                isInterrupted: undefined,
                finalOutput: stringOutput,
            };
        }
        return NOT_FINAL_OUTPUT;
    }
    if (typeof toolUseBehavior === 'function') {
        return toolUseBehavior(state._context, toolResults);
    }
    throw new errors_1.UserError(`Invalid toolUseBehavior: ${toolUseBehavior}`, state);
}
/**
 * Accepts whatever the tool returned and attempts to coerce it into the structured protocol
 * shapes we expose to downstream model adapters (input_text/input_image/input_file). Tools are
 * allowed to return either a single structured object or an array of them; anything else falls
 * back to the legacy string pipeline.
 */
function normalizeStructuredToolOutputs(output) {
    if (Array.isArray(output)) {
        const structured = [];
        for (const item of output) {
            const normalized = normalizeStructuredToolOutput(item);
            if (!normalized) {
                return null;
            }
            structured.push(normalized);
        }
        return structured;
    }
    const normalized = normalizeStructuredToolOutput(output);
    return normalized ? [normalized] : null;
}
/**
 * Best-effort normalization of a single tool output item. If the object already matches the
 * protocol shape we simply cast it; otherwise we copy the recognised fields into the canonical
 * structure. Returning null lets the caller know we should revert to plain-string handling.
 */
function normalizeStructuredToolOutput(value) {
    if (!isRecord(value)) {
        return null;
    }
    const type = value.type;
    if (type === 'text' && typeof value.text === 'string') {
        const output = { type: 'text', text: value.text };
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    if (type === 'image') {
        const output = { type: 'image' };
        let imageString;
        let imageFileId;
        const fallbackImageMediaType = isNonEmptyString(value.mediaType)
            ? value.mediaType
            : undefined;
        const imageField = value.image;
        if (typeof imageField === 'string' && imageField.length > 0) {
            imageString = imageField;
        }
        else if (isRecord(imageField)) {
            const imageObj = imageField;
            const inlineMediaType = isNonEmptyString(imageObj.mediaType)
                ? imageObj.mediaType
                : fallbackImageMediaType;
            if (isNonEmptyString(imageObj.url)) {
                imageString = imageObj.url;
            }
            else if (isNonEmptyString(imageObj.data)) {
                imageString = toInlineImageString(imageObj.data, inlineMediaType);
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                imageString = toInlineImageString(imageObj.data, inlineMediaType);
            }
            if (!imageString) {
                const candidateId = (isNonEmptyString(imageObj.fileId) && imageObj.fileId) ||
                    (isNonEmptyString(imageObj.id) && imageObj.id) ||
                    undefined;
                if (candidateId) {
                    imageFileId = candidateId;
                }
            }
        }
        if (!imageString &&
            typeof value.imageUrl === 'string' &&
            value.imageUrl.length > 0) {
            imageString = value.imageUrl;
        }
        if (!imageFileId &&
            typeof value.fileId === 'string' &&
            value.fileId.length > 0) {
            imageFileId = value.fileId;
        }
        if (!imageString &&
            typeof value.data === 'string' &&
            value.data.length > 0) {
            imageString = fallbackImageMediaType
                ? toInlineImageString(value.data, fallbackImageMediaType)
                : value.data;
        }
        else if (!imageString &&
            value.data instanceof Uint8Array &&
            value.data.length > 0) {
            imageString = toInlineImageString(value.data, fallbackImageMediaType);
        }
        if (typeof value.detail === 'string' && value.detail.length > 0) {
            output.detail = value.detail;
        }
        if (imageString) {
            output.image = imageString;
        }
        else if (imageFileId) {
            output.image = { fileId: imageFileId };
        }
        else {
            return null;
        }
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    if (type === 'file') {
        const fileValue = normalizeFileValue(value);
        if (!fileValue) {
            return null;
        }
        const output = { type: 'file', file: fileValue };
        if (isRecord(value.providerData)) {
            output.providerData = value.providerData;
        }
        return output;
    }
    return null;
}
/**
 * Translates the normalized tool output into the protocol `input_*` items. This is the last hop
 * before we hand the data to model-specific adapters, so we generate the exact schema expected by
 * the protocol definitions.
 */
function convertStructuredToolOutputToInputItem(output) {
    if (output.type === 'text') {
        const result = {
            type: 'input_text',
            text: output.text,
        };
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    if (output.type === 'image') {
        const result = { type: 'input_image' };
        if (typeof output.detail === 'string' && output.detail.length > 0) {
            result.detail = output.detail;
        }
        if (typeof output.image === 'string' && output.image.length > 0) {
            result.image = output.image;
        }
        else if (isRecord(output.image)) {
            const imageObj = output.image;
            const inlineMediaType = isNonEmptyString(imageObj.mediaType)
                ? imageObj.mediaType
                : undefined;
            if (isNonEmptyString(imageObj.url)) {
                result.image = imageObj.url;
            }
            else if (isNonEmptyString(imageObj.data)) {
                result.image =
                    inlineMediaType && !imageObj.data.startsWith('data:')
                        ? asDataUrl(imageObj.data, inlineMediaType)
                        : imageObj.data;
            }
            else if (imageObj.data instanceof Uint8Array &&
                imageObj.data.length > 0) {
                const base64 = (0, base64_1.encodeUint8ArrayToBase64)(imageObj.data);
                result.image = asDataUrl(base64, inlineMediaType);
            }
            else {
                const referencedId = (isNonEmptyString(imageObj.fileId) && imageObj.fileId) ||
                    (isNonEmptyString(imageObj.id) && imageObj.id) ||
                    undefined;
                if (referencedId) {
                    result.image = { id: referencedId };
                }
            }
        }
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    if (output.type === 'file') {
        const result = { type: 'input_file' };
        const fileValue = output.file;
        if (typeof fileValue === 'string') {
            result.file = fileValue;
        }
        else if (fileValue && typeof fileValue === 'object') {
            const record = fileValue;
            if ('data' in record && record.data) {
                const mediaType = record.mediaType ?? 'text/plain';
                if (typeof record.data === 'string') {
                    result.file = asDataUrl(record.data, mediaType);
                }
                else {
                    const base64 = (0, base64_1.encodeUint8ArrayToBase64)(record.data);
                    result.file = asDataUrl(base64, mediaType);
                }
            }
            else if (typeof record.url === 'string' && record.url.length > 0) {
                result.file = { url: record.url };
            }
            else {
                const referencedId = (typeof record.id === 'string' &&
                    record.id.length > 0 &&
                    record.id) ||
                    (typeof record.fileId === 'string' && record.fileId.length > 0
                        ? record.fileId
                        : undefined);
                if (referencedId) {
                    result.file = { id: referencedId };
                }
            }
            if (typeof record.filename === 'string' && record.filename.length > 0) {
                result.filename = record.filename;
            }
        }
        if (output.providerData) {
            result.providerData = output.providerData;
        }
        return result;
    }
    const exhaustiveCheck = output;
    return exhaustiveCheck;
}
function normalizeFileValue(value) {
    const directFile = value.file;
    if (typeof directFile === 'string' && directFile.length > 0) {
        return directFile;
    }
    const normalizedObject = normalizeFileObjectCandidate(directFile);
    if (normalizedObject) {
        return normalizedObject;
    }
    const legacyValue = normalizeLegacyFileValue(value);
    if (legacyValue) {
        return legacyValue;
    }
    return null;
}
function normalizeFileObjectCandidate(value) {
    if (!isRecord(value)) {
        return null;
    }
    if ('data' in value && value.data !== undefined) {
        const dataValue = value.data;
        const hasStringData = typeof dataValue === 'string' && dataValue.length > 0;
        const hasBinaryData = dataValue instanceof Uint8Array && dataValue.length > 0;
        if (!hasStringData && !hasBinaryData) {
            return null;
        }
        if (!isNonEmptyString(value.mediaType) ||
            !isNonEmptyString(value.filename)) {
            return null;
        }
        return {
            data: typeof dataValue === 'string' ? dataValue : new Uint8Array(dataValue),
            mediaType: value.mediaType,
            filename: value.filename,
        };
    }
    if (isNonEmptyString(value.url)) {
        const result = { url: value.url };
        if (isNonEmptyString(value.filename)) {
            result.filename = value.filename;
        }
        return result;
    }
    const referencedId = (isNonEmptyString(value.id) && value.id) ||
        (isNonEmptyString(value.fileId) && value.fileId);
    if (referencedId) {
        const result = { id: referencedId };
        if (isNonEmptyString(value.filename)) {
            result.filename = value.filename;
        }
        return result;
    }
    return null;
}
function normalizeLegacyFileValue(value) {
    const filename = typeof value.filename === 'string' && value.filename.length > 0
        ? value.filename
        : undefined;
    const mediaType = typeof value.mediaType === 'string' && value.mediaType.length > 0
        ? value.mediaType
        : undefined;
    if (typeof value.fileData === 'string' && value.fileData.length > 0) {
        if (!mediaType || !filename) {
            return null;
        }
        return { data: value.fileData, mediaType, filename };
    }
    if (value.fileData instanceof Uint8Array && value.fileData.length > 0) {
        if (!mediaType || !filename) {
            return null;
        }
        return { data: new Uint8Array(value.fileData), mediaType, filename };
    }
    if (typeof value.fileUrl === 'string' && value.fileUrl.length > 0) {
        const result = { url: value.fileUrl };
        if (filename) {
            result.filename = filename;
        }
        return result;
    }
    if (typeof value.fileId === 'string' && value.fileId.length > 0) {
        const result = { id: value.fileId };
        if (filename) {
            result.filename = filename;
        }
        return result;
    }
    return null;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
function toInlineImageString(data, mediaType) {
    if (typeof data === 'string') {
        if (mediaType && !data.startsWith('data:')) {
            return asDataUrl(data, mediaType);
        }
        return data;
    }
    const base64 = (0, base64_1.encodeUint8ArrayToBase64)(data);
    return asDataUrl(base64, mediaType);
}
function asDataUrl(base64, mediaType) {
    return mediaType ? `data:${mediaType};base64,${base64}` : base64;
}
//# sourceMappingURL=toolExecution.js.map