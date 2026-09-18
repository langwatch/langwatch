"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextStepSchema = void 0;
exports.resolveInterruptedTurn = resolveInterruptedTurn;
exports.resolveTurnAfterModelResponse = resolveTurnAfterModelResponse;
const zod_1 = require("zod");
const errors_1 = require("../errors.js");
const items_1 = require("../items.js");
const messages_1 = require("../utils/messages.js");
const tools_1 = require("../utils/tools.js");
const safeExecute_1 = require("../utils/safeExecute.js");
const context_1 = require("../tracing/context.js");
const steps_1 = require("./steps.js");
Object.defineProperty(exports, "nextStepSchema", { enumerable: true, get: function () { return steps_1.nextStepSchema; } });
const toolExecution_1 = require("./toolExecution.js");
const mcpApprovals_1 = require("./mcpApprovals.js");
const APPROVAL_ITEM_TYPES = [
    'function_call',
    'hosted_tool_call',
    'shell_call',
    'apply_patch_call',
];
function isHostedMcpApprovalItem(item) {
    return (item.rawItem.type === 'hosted_tool_call' &&
        item.rawItem.providerData?.type === 'mcp_approval_request');
}
function resolveApprovalState(item, state) {
    if (isHostedMcpApprovalItem(item)) {
        return 'pending';
    }
    const rawItem = item.rawItem;
    const toolName = item.toolName ??
        ('name' in rawItem && typeof rawItem.name === 'string'
            ? rawItem.name
            : undefined);
    const callId = 'callId' in rawItem && typeof rawItem.callId === 'string'
        ? rawItem.callId
        : 'id' in rawItem && typeof rawItem.id === 'string'
            ? rawItem.id
            : undefined;
    if (!toolName || !callId) {
        return 'pending';
    }
    const approval = state._context.isToolApproved({ toolName, callId });
    if (approval === true) {
        return 'approved';
    }
    if (approval === false) {
        return 'rejected';
    }
    return 'pending';
}
function isApprovalItemLike(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (!('rawItem' in value)) {
        return false;
    }
    const rawItem = value.rawItem;
    if (!rawItem || typeof rawItem !== 'object') {
        return false;
    }
    const itemType = rawItem.type;
    return APPROVAL_ITEM_TYPES.includes(itemType);
}
function getApprovalIdentity(approval) {
    const rawItem = approval.rawItem;
    if (!rawItem) {
        return undefined;
    }
    if (rawItem.type === 'function_call' && rawItem.callId) {
        return `function_call:${rawItem.callId}`;
    }
    if ('callId' in rawItem && rawItem.callId) {
        return `${rawItem.type}:${rawItem.callId}`;
    }
    const id = 'id' in rawItem ? rawItem.id : undefined;
    if (id) {
        return `${rawItem.type}:${id}`;
    }
    const providerData = typeof rawItem.providerData === 'object' && rawItem.providerData
        ? rawItem.providerData
        : undefined;
    if (providerData?.id) {
        return `${rawItem.type}:provider:${providerData.id}`;
    }
    const agentName = 'agent' in approval && approval.agent ? approval.agent.name : '';
    try {
        return `${agentName}:${rawItem.type}:${JSON.stringify(rawItem)}`;
    }
    catch {
        return `${agentName}:${rawItem.type}`;
    }
}
function buildAppendContext(existingItems) {
    const seenItems = new Set(existingItems);
    const seenApprovalIdentities = new Set();
    for (const item of existingItems) {
        if (item instanceof items_1.RunToolApprovalItem) {
            const identity = getApprovalIdentity(item);
            if (identity) {
                seenApprovalIdentities.add(identity);
            }
        }
    }
    return { seenItems, seenApprovalIdentities };
}
function appendRunItemIfNew(item, target, context) {
    if (context.seenItems.has(item)) {
        return;
    }
    if (item instanceof items_1.RunToolApprovalItem) {
        const identity = getApprovalIdentity(item);
        if (identity) {
            if (context.seenApprovalIdentities.has(identity)) {
                return;
            }
            context.seenApprovalIdentities.add(identity);
        }
    }
    context.seenItems.add(item);
    target.push(item);
}
function buildApprovedCallIdSet(items, type) {
    const callIds = new Set();
    for (const item of items) {
        if (!(item instanceof items_1.RunToolApprovalItem)) {
            continue;
        }
        const rawItem = item.rawItem;
        if (!rawItem || rawItem.type !== type) {
            continue;
        }
        if ('callId' in rawItem && rawItem.callId) {
            callIds.add(rawItem.callId);
        }
        else if ('id' in rawItem && rawItem.id) {
            callIds.add(rawItem.id);
        }
    }
    return callIds;
}
function collectCompletedCallIds(items, type) {
    const completed = new Set();
    for (const item of items) {
        const rawItem = item.rawItem;
        if (!rawItem || typeof rawItem !== 'object') {
            continue;
        }
        if (rawItem.type !== type) {
            continue;
        }
        const callId = rawItem.callId;
        if (typeof callId === 'string') {
            completed.add(callId);
        }
    }
    return completed;
}
function filterActionsByApproval(preStepItems, actions, type) {
    const allowedCallIds = buildApprovedCallIdSet(preStepItems, type);
    if (allowedCallIds.size === 0) {
        return [];
    }
    return actions.filter((action) => typeof action.toolCall.callId === 'string' &&
        allowedCallIds.has(action.toolCall.callId));
}
function filterPendingActions(actions, options) {
    return actions.filter((action) => {
        const callId = action.toolCall.callId;
        const hasCallId = typeof callId === 'string';
        if (options.allowedCallIds && options.allowedCallIds.size > 0) {
            if (!hasCallId || !options.allowedCallIds.has(callId)) {
                return false;
            }
        }
        if (hasCallId && options.completedCallIds.has(callId)) {
            return false;
        }
        return true;
    });
}
function truncateForDeveloper(message, maxLength = 160) {
    const trimmed = message.trim();
    if (!trimmed) {
        return 'Schema validation failed.';
    }
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 3)}...`;
}
function formatFinalOutputTypeError(error) {
    // Surface structured output validation hints without echoing potentially large or sensitive payloads.
    try {
        if (error instanceof zod_1.z.ZodError) {
            const issue = error.issues[0];
            if (issue) {
                const issuePathParts = Array.isArray(issue.path) ? issue.path : [];
                const issuePath = issuePathParts.length > 0
                    ? issuePathParts.map((part) => String(part)).join('.')
                    : '(root)';
                const message = truncateForDeveloper(issue.message ?? '');
                return `Invalid output type: final assistant output failed schema validation at "${issuePath}" (${message}).`;
            }
            return 'Invalid output type: final assistant output failed schema validation.';
        }
        if (error instanceof Error && error.message) {
            return `Invalid output type: ${truncateForDeveloper(error.message)}`;
        }
    }
    catch {
        // Swallow formatting errors so we can return a generic message below.
    }
    return 'Invalid output type: final assistant output did not match the expected schema.';
}
/**
 * @internal
 * Continues a turn that was previously interrupted waiting for tool approval. Executes the now
 * approved tools and returns the resulting step transition.
 */
async function resolveInterruptedTurn(agent, originalInput, originalPreStepItems, newResponse, processedResponse, runner, state) {
    // call_ids for function tools
    const functionCallIds = originalPreStepItems
        .filter((item) => item instanceof items_1.RunToolApprovalItem &&
        'callId' in item.rawItem &&
        item.rawItem.type === 'function_call')
        .map((item) => item.rawItem.callId);
    const completedFunctionCallIds = collectCompletedCallIds(originalPreStepItems, 'function_call_result');
    const completedShellCallIds = collectCompletedCallIds(originalPreStepItems, 'shell_call_output');
    const completedApplyPatchCallIds = collectCompletedCallIds(originalPreStepItems, 'apply_patch_call_output');
    // We already persisted the turn once when the approval interrupt was raised, so the
    // counter reflects the approval items as "flushed". When we resume the same turn we need
    // to rewind it so the eventual tool output for this call is still written to the session.
    const pendingApprovalItems = state
        .getInterruptions()
        .filter(isApprovalItemLike);
    const pendingApprovalIdentities = new Set();
    for (const approval of pendingApprovalItems) {
        if (!(approval instanceof items_1.RunToolApprovalItem)) {
            continue;
        }
        if (isHostedMcpApprovalItem(approval)) {
            continue;
        }
        const rawItem = approval.rawItem;
        if (rawItem.type === 'function_call' &&
            rawItem.callId &&
            completedFunctionCallIds.has(rawItem.callId)) {
            continue;
        }
        if (rawItem.type === 'shell_call' &&
            rawItem.callId &&
            completedShellCallIds.has(rawItem.callId)) {
            continue;
        }
        if (rawItem.type === 'apply_patch_call' &&
            rawItem.callId &&
            completedApplyPatchCallIds.has(rawItem.callId)) {
            continue;
        }
        const identity = getApprovalIdentity(approval);
        if (identity) {
            if (resolveApprovalState(approval, state) === 'pending') {
                pendingApprovalIdentities.add(identity);
            }
        }
    }
    // Run function tools that require approval after they get their approval results
    const functionToolRuns = processedResponse.functions.filter((run) => {
        const callId = run.toolCall.callId;
        if (!functionCallIds.includes(callId)) {
            return false;
        }
        return !completedFunctionCallIds.has(callId);
    });
    const shellRuns = filterPendingActions(filterActionsByApproval(originalPreStepItems, processedResponse.shellActions, 'shell_call'), {
        completedCallIds: completedShellCallIds,
    });
    const pendingComputerActions = filterPendingActions(processedResponse.computerActions, {
        completedCallIds: collectCompletedCallIds(originalPreStepItems, 'computer_call_result'),
    });
    const applyPatchRuns = filterPendingActions(filterActionsByApproval(originalPreStepItems, processedResponse.applyPatchActions, 'apply_patch_call'), {
        completedCallIds: completedApplyPatchCallIds,
    });
    const functionResults = await (0, toolExecution_1.executeFunctionToolCalls)(agent, functionToolRuns, runner, state);
    // There is no built-in HITL approval surface for computer tools today, so every pending action
    // is executed immediately when the turn resumes.
    const computerResults = pendingComputerActions.length > 0
        ? await (0, toolExecution_1.executeComputerActions)(agent, pendingComputerActions, runner, state._context)
        : [];
    const shellResults = shellRuns.length > 0
        ? await (0, toolExecution_1.executeShellActions)(agent, shellRuns, runner, state._context)
        : [];
    const applyPatchResults = applyPatchRuns.length > 0
        ? await (0, toolExecution_1.executeApplyPatchOperations)(agent, applyPatchRuns, runner, state._context)
        : [];
    const newItems = [];
    const appendContext = buildAppendContext(originalPreStepItems);
    const appendIfNew = (item) => appendRunItemIfNew(item, newItems, appendContext);
    for (const result of functionResults) {
        appendIfNew(result.runItem);
    }
    for (const result of computerResults) {
        appendIfNew(result);
    }
    for (const result of shellResults) {
        appendIfNew(result);
    }
    for (const result of applyPatchResults) {
        appendIfNew(result);
    }
    const additionalInterruptions = (0, toolExecution_1.collectInterruptions)([], [...shellResults, ...applyPatchResults]);
    const hostedMcpApprovals = await (0, mcpApprovals_1.handleHostedMcpApprovals)({
        requests: processedResponse.mcpApprovalRequests,
        agent,
        state,
        functionResults,
        appendIfNew,
        resolveApproval: (rawItem) => {
            const providerData = rawItem.providerData;
            const approvalRequestId = rawItem.id ?? providerData?.id;
            if (!approvalRequestId) {
                return undefined;
            }
            return state._context.isToolApproved({
                toolName: rawItem.name,
                callId: approvalRequestId,
            });
        },
    });
    // Server-managed conversations rely on preStepItems to re-surface pending approvals.
    // Keep unresolved hosted MCP approvals in place so HITL flows still have something to approve next turn.
    // Drop resolved approval placeholders so they are not replayed on the next turn, but keep
    // pending approvals in place to signal the outstanding work to the UI and session store.
    const preStepItems = originalPreStepItems.filter((item) => {
        if (!(item instanceof items_1.RunToolApprovalItem)) {
            return true;
        }
        if (isHostedMcpApprovalItem(item)) {
            if (hostedMcpApprovals.pendingApprovals.has(item)) {
                return true;
            }
            const approvalRequestId = item.rawItem.id ??
                item.rawItem.providerData?.id;
            if (approvalRequestId) {
                return hostedMcpApprovals.pendingApprovalIds.has(approvalRequestId);
            }
            return false;
        }
        // Preserve all other approval items so resumptions can continue to reference the
        // original approval requests (e.g., function/shell/apply_patch) ONLY while they are still pending.
        const identity = getApprovalIdentity(item);
        if (!identity) {
            return true;
        }
        return pendingApprovalIdentities.has(identity);
    });
    const keptApprovalItems = new Set();
    for (const item of preStepItems) {
        if (item instanceof items_1.RunToolApprovalItem) {
            keptApprovalItems.add(item);
        }
    }
    let removedApprovalCount = 0;
    for (const item of originalPreStepItems) {
        if (item instanceof items_1.RunToolApprovalItem && !keptApprovalItems.has(item)) {
            removedApprovalCount++;
        }
    }
    if (removedApprovalCount > 0) {
        // Persisting the approval request already advanced the counter once, so undo the increment
        // to make sure we write the final tool output back to the session when the turn resumes.
        state.rewindTurnPersistence(removedApprovalCount);
    }
    const completedStep = await maybeCompleteTurnFromToolResults({
        agent,
        runner,
        state,
        functionResults,
        originalInput,
        newResponse,
        preStepItems,
        newItems,
        additionalInterruptions,
    });
    if (completedStep) {
        return completedStep;
    }
    // we only ran new tools and side effects. We need to run the rest of the agent
    return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, { type: 'next_step_run_again' });
}
/**
 * @internal
 * Executes every follow-up action the model requested (function tools, computer actions, MCP flows),
 * appends their outputs to the run history, and determines the next step for the agent loop.
 */
async function resolveTurnAfterModelResponse(agent, originalInput, originalPreStepItems, newResponse, processedResponse, runner, state) {
    // Reuse the same array reference so we can compare object identity when deciding whether to
    // append new items, ensuring we never double-stream existing RunItems.
    const preStepItems = originalPreStepItems;
    const newItems = [];
    const appendContext = buildAppendContext(originalPreStepItems);
    const appendIfNew = (item) => appendRunItemIfNew(item, newItems, appendContext);
    for (const item of processedResponse.newItems) {
        appendIfNew(item);
    }
    // Run function tools and computer actions in parallel; neither depends on the other's side effects.
    const [functionResults, computerResults, shellResults, applyPatchResults] = await Promise.all([
        (0, toolExecution_1.executeFunctionToolCalls)(agent, processedResponse.functions, runner, state),
        (0, toolExecution_1.executeComputerActions)(agent, processedResponse.computerActions, runner, state._context),
        (0, toolExecution_1.executeShellActions)(agent, processedResponse.shellActions, runner, state._context),
        (0, toolExecution_1.executeApplyPatchOperations)(agent, processedResponse.applyPatchActions, runner, state._context),
    ]);
    for (const result of functionResults) {
        appendIfNew(result.runItem);
    }
    for (const item of computerResults) {
        appendIfNew(item);
    }
    for (const item of shellResults) {
        appendIfNew(item);
    }
    for (const item of applyPatchResults) {
        appendIfNew(item);
    }
    const additionalInterruptions = (0, toolExecution_1.collectInterruptions)([], [...shellResults, ...applyPatchResults]);
    if (processedResponse.mcpApprovalRequests.length > 0) {
        await (0, mcpApprovals_1.handleHostedMcpApprovals)({
            requests: processedResponse.mcpApprovalRequests,
            agent,
            state,
            functionResults,
            appendIfNew,
            resolveApproval: (rawItem) => {
                const providerData = rawItem.providerData;
                const approvalRequestId = rawItem.id ?? providerData?.id;
                if (!approvalRequestId) {
                    return undefined;
                }
                return state._context.isToolApproved({
                    toolName: rawItem.name,
                    callId: approvalRequestId,
                });
            },
        });
    }
    // process handoffs
    if (processedResponse.handoffs.length > 0) {
        return await (0, toolExecution_1.executeHandoffCalls)(agent, originalInput, preStepItems, newItems, newResponse, processedResponse.handoffs, runner, state._context);
    }
    const completedStep = await maybeCompleteTurnFromToolResults({
        agent,
        runner,
        state,
        functionResults,
        originalInput,
        newResponse,
        preStepItems,
        newItems,
        additionalInterruptions,
    });
    if (completedStep) {
        return completedStep;
    }
    // If the model issued any tool calls or handoffs in this turn,
    // we must NOT treat any assistant message in the same turn as the final output.
    // We should run the loop again so the model can see the tool results and respond.
    if (processedResponse.hasToolsOrApprovalsToRun()) {
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, { type: 'next_step_run_again' });
    }
    // No tool calls/actions in this turn; safe to consider a plain assistant message as final.
    const messageItems = newItems.filter((item) => item instanceof items_1.RunMessageOutputItem);
    // we will use the last content output as the final output
    const potentialFinalOutput = messageItems.length > 0
        ? (0, messages_1.getLastTextFromOutputMessage)(messageItems[messageItems.length - 1].rawItem)
        : undefined;
    // if there is no output we just run again
    if (typeof potentialFinalOutput === 'undefined') {
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, { type: 'next_step_run_again' });
    }
    // Keep looping if any tool output placeholders still require an approval follow-up.
    const hasPendingToolsOrApprovals = functionResults.some((result) => result.runItem instanceof items_1.RunToolApprovalItem) || additionalInterruptions.length > 0;
    if (!hasPendingToolsOrApprovals) {
        if (agent.outputType === 'text') {
            return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, {
                type: 'next_step_final_output',
                output: potentialFinalOutput,
            });
        }
        if (agent.outputType !== 'text' && potentialFinalOutput) {
            // Structured output schema => always leads to a final output if we have text.
            const { parser } = (0, tools_1.getSchemaAndParserFromInputType)(agent.outputType, 'final_output');
            const [error] = await (0, safeExecute_1.safeExecute)(() => parser(potentialFinalOutput));
            if (error) {
                const outputErrorMessage = formatFinalOutputTypeError(error);
                (0, context_1.addErrorToCurrentSpan)({
                    message: outputErrorMessage,
                    data: {
                        error: String(error),
                    },
                });
                throw new errors_1.ModelBehaviorError(outputErrorMessage);
            }
            return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, { type: 'next_step_final_output', output: potentialFinalOutput });
        }
    }
    return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, { type: 'next_step_run_again' });
}
// Consolidates the logic that determines whether tool results yielded a final answer,
// triggered an interruption, or require the agent loop to continue running.
async function maybeCompleteTurnFromToolResults({ agent, runner: _runner, state, functionResults, originalInput, newResponse, preStepItems, newItems, additionalInterruptions = [], }) {
    const toolOutcome = await (0, toolExecution_1.checkForFinalOutputFromTools)(agent, functionResults, state, additionalInterruptions);
    if (toolOutcome.isFinalOutput) {
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, {
            type: 'next_step_final_output',
            output: toolOutcome.finalOutput,
        });
    }
    if (toolOutcome.isInterrupted) {
        return new steps_1.SingleStepResult(originalInput, newResponse, preStepItems, newItems, {
            type: 'next_step_interruption',
            data: {
                interruptions: toolOutcome.interruptions,
            },
        });
    }
    return null;
}
//# sourceMappingURL=turnResolution.js.map