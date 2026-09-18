import { RunToolCallItem } from "../items.mjs";
/**
 * Normalizes hosted MCP approval flows so streaming and non-streaming loops share identical
 * behavior. Handles synchronous approvals, previously decided approvals, and pending approvals.
 */
export async function handleHostedMcpApprovals({ requests, agent, state, functionResults, appendIfNew, resolveApproval, }) {
    const pendingApprovals = new Set();
    const pendingApprovalIds = new Set();
    for (const approvalRequest of requests) {
        const rawItem = approvalRequest.requestItem.rawItem;
        if (rawItem.type !== 'hosted_tool_call') {
            continue;
        }
        const providerData = rawItem.providerData;
        if (!providerData) {
            continue;
        }
        const toolData = approvalRequest.mcpTool.providerData;
        const approvalRequestId = rawItem.id ?? providerData.id;
        if (toolData?.on_approval) {
            const approvalResult = await toolData.on_approval(state._context, approvalRequest.requestItem);
            const approvalResponseData = {
                approve: approvalResult.approve,
                approval_request_id: approvalRequestId ?? providerData.id,
                reason: approvalResult.reason,
            };
            appendIfNew(new RunToolCallItem({
                type: 'hosted_tool_call',
                name: 'mcp_approval_response',
                providerData: approvalResponseData,
            }, agent));
            continue;
        }
        const approvalDecision = typeof resolveApproval === 'function'
            ? resolveApproval(rawItem)
            : undefined;
        if (typeof approvalDecision !== 'undefined' && approvalRequestId) {
            const approvalResponseData = {
                approve: approvalDecision,
                approval_request_id: approvalRequestId,
                reason: undefined,
            };
            appendIfNew(new RunToolCallItem({
                type: 'hosted_tool_call',
                name: 'mcp_approval_response',
                providerData: approvalResponseData,
            }, agent));
            continue;
        }
        functionResults.push({
            type: 'hosted_mcp_tool_approval',
            tool: approvalRequest.mcpTool,
            runItem: approvalRequest.requestItem,
        });
        appendIfNew(approvalRequest.requestItem);
        pendingApprovals.add(approvalRequest.requestItem);
        if (approvalRequestId) {
            pendingApprovalIds.add(approvalRequestId);
        }
    }
    return { pendingApprovals, pendingApprovalIds };
}
//# sourceMappingURL=mcpApprovals.mjs.map