"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processModelResponse = processModelResponse;
const errors_1 = require("../errors.js");
const items_1 = require("../items.js");
const context_1 = require("../tracing/context.js");
function ensureToolAvailable(tool, message, data) {
    if (!tool) {
        (0, context_1.addErrorToCurrentSpan)({
            message,
            data,
        });
        throw new errors_1.ModelBehaviorError(message);
    }
    return tool;
}
function handleToolCallAction({ output, tool, agent, errorMessage, errorData, items, toolsUsed, actions, buildAction, }) {
    const resolvedTool = ensureToolAvailable(tool, errorMessage, errorData);
    items.push(new items_1.RunToolCallItem(output, agent));
    toolsUsed.push(resolvedTool.name);
    actions.push(buildAction(resolvedTool));
}
function resolveFunctionOrHandoff(toolCall, handoffMap, functionMap, agent) {
    const handoff = handoffMap.get(toolCall.name);
    if (handoff) {
        return { type: 'handoff', handoff };
    }
    const functionTool = functionMap.get(toolCall.name);
    if (!functionTool) {
        const message = `Tool ${toolCall.name} not found in agent ${agent.name}.`;
        (0, context_1.addErrorToCurrentSpan)({
            message,
            data: {
                tool_name: toolCall.name,
                agent_name: agent.name,
            },
        });
        throw new errors_1.ModelBehaviorError(message);
    }
    return { type: 'function', tool: functionTool };
}
/**
 * Walks a raw model response and classifies each item so the runner can schedule follow-up work.
 * Returns both the serializable RunItems (for history/streaming) and the actionable tool metadata.
 */
function processModelResponse(modelResponse, agent, tools, handoffs) {
    const items = [];
    const runHandoffs = [];
    const runFunctions = [];
    const runComputerActions = [];
    const runShellActions = [];
    const runApplyPatchActions = [];
    const runMCPApprovalRequests = [];
    const toolsUsed = [];
    const handoffMap = new Map(handoffs.map((h) => [h.toolName, h]));
    // Resolve tools upfront so we can look up the concrete handler in O(1) while iterating outputs.
    const functionMap = new Map(tools
        .filter((t) => t.type === 'function')
        .map((t) => [t.name, t]));
    const computerTool = tools.find((t) => t.type === 'computer');
    const shellTool = tools.find((t) => t.type === 'shell');
    const applyPatchTool = tools.find((t) => t.type === 'apply_patch');
    const mcpToolMap = new Map(tools
        .filter((t) => t.type === 'hosted_tool' && t.providerData?.type === 'mcp')
        .map((t) => t)
        .map((t) => [t.providerData.server_label, t]));
    for (const output of modelResponse.output) {
        if (output.type === 'message') {
            if (output.role === 'assistant') {
                items.push(new items_1.RunMessageOutputItem(output, agent));
            }
        }
        else if (output.type === 'hosted_tool_call') {
            items.push(new items_1.RunToolCallItem(output, agent));
            const toolName = output.name;
            toolsUsed.push(toolName);
            if (output.providerData?.type === 'mcp_approval_request' ||
                output.name === 'mcp_approval_request') {
                // Hosted remote MCP server's approval process
                const providerData = output.providerData;
                const mcpServerLabel = providerData.server_label;
                const mcpServerTool = mcpToolMap.get(mcpServerLabel);
                if (typeof mcpServerTool === 'undefined') {
                    const message = `MCP server (${mcpServerLabel}) not found in Agent (${agent.name})`;
                    (0, context_1.addErrorToCurrentSpan)({
                        message,
                        data: { mcp_server_label: mcpServerLabel },
                    });
                    throw new errors_1.ModelBehaviorError(message);
                }
                // Do this approval later:
                // We support both onApproval callback (like the Python SDK does) and HITL patterns.
                const approvalItem = new items_1.RunToolApprovalItem({
                    type: 'hosted_tool_call',
                    // We must use this name to align with the name sent from the servers
                    name: providerData.name,
                    id: providerData.id,
                    status: 'in_progress',
                    providerData,
                }, agent);
                runMCPApprovalRequests.push({
                    requestItem: approvalItem,
                    mcpTool: mcpServerTool,
                });
                if (!mcpServerTool.providerData.on_approval) {
                    // When onApproval function exists, it confirms the approval right after this.
                    // Thus, this approval item must be appended only for the next turn interruption patterns.
                    items.push(approvalItem);
                }
            }
        }
        else if (output.type === 'reasoning') {
            items.push(new items_1.RunReasoningItem(output, agent));
        }
        else if (output.type === 'computer_call') {
            handleToolCallAction({
                output,
                tool: computerTool,
                agent,
                errorMessage: 'Model produced computer action without a computer tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runComputerActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    computer: resolvedTool,
                }),
            });
        }
        else if (output.type === 'shell_call') {
            handleToolCallAction({
                output,
                tool: shellTool,
                agent,
                errorMessage: 'Model produced shell action without a shell tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runShellActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    shell: resolvedTool,
                }),
            });
        }
        else if (output.type === 'apply_patch_call') {
            handleToolCallAction({
                output,
                tool: applyPatchTool,
                agent,
                errorMessage: 'Model produced apply_patch action without an apply_patch tool.',
                errorData: { agent_name: agent.name },
                items,
                toolsUsed,
                actions: runApplyPatchActions,
                buildAction: (resolvedTool) => ({
                    toolCall: output,
                    applyPatch: resolvedTool,
                }),
            });
        }
        /*
         * Intentionally skip returning here so function_call processing can still
         * run when output.type matches other tool call types.
         */
        if (output.type !== 'function_call') {
            continue;
        }
        toolsUsed.push(output.name);
        const resolved = resolveFunctionOrHandoff(output, handoffMap, functionMap, agent);
        if (resolved.type === 'handoff') {
            items.push(new items_1.RunHandoffCallItem(output, agent));
            runHandoffs.push({
                toolCall: output,
                handoff: resolved.handoff,
            });
        }
        else {
            items.push(new items_1.RunToolCallItem(output, agent));
            runFunctions.push({
                toolCall: output,
                tool: resolved.tool,
            });
        }
    }
    return {
        newItems: items,
        handoffs: runHandoffs,
        functions: runFunctions,
        computerActions: runComputerActions,
        shellActions: runShellActions,
        applyPatchActions: runApplyPatchActions,
        mcpApprovalRequests: runMCPApprovalRequests,
        toolsUsed: toolsUsed,
        hasToolsOrApprovalsToRun() {
            return (runHandoffs.length > 0 ||
                runFunctions.length > 0 ||
                runMCPApprovalRequests.length > 0 ||
                runComputerActions.length > 0 ||
                runShellActions.length > 0 ||
                runApplyPatchActions.length > 0);
        },
    };
}
//# sourceMappingURL=modelOutputs.js.map