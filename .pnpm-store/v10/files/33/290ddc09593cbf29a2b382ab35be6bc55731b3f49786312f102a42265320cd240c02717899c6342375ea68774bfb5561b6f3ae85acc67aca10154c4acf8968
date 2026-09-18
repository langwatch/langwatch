import { Agent } from '../agent';
import { RunItem, RunToolApprovalItem } from '../items';
import { RunState } from '../runState';
import { FunctionToolResult } from '../tool';
import * as protocol from '../types/protocol';
import type { ToolRunMCPApprovalRequest } from './types';
type ResolveApproval = (rawItem: protocol.HostedToolCallItem) => boolean | undefined;
type HandleHostedMcpApprovalsParams<TContext> = {
    requests: ToolRunMCPApprovalRequest[];
    agent: Agent<TContext, any>;
    state: RunState<TContext, Agent<TContext, any>>;
    functionResults: FunctionToolResult<TContext>[];
    appendIfNew: (item: RunItem) => void;
    resolveApproval?: ResolveApproval;
};
export type HandleHostedMcpApprovalsResult = {
    pendingApprovals: Set<RunToolApprovalItem>;
    pendingApprovalIds: Set<string>;
};
/**
 * Normalizes hosted MCP approval flows so streaming and non-streaming loops share identical
 * behavior. Handles synchronous approvals, previously decided approvals, and pending approvals.
 */
export declare function handleHostedMcpApprovals<TContext>({ requests, agent, state, functionResults, appendIfNew, resolveApproval, }: HandleHostedMcpApprovalsParams<TContext>): Promise<HandleHostedMcpApprovalsResult>;
export {};
