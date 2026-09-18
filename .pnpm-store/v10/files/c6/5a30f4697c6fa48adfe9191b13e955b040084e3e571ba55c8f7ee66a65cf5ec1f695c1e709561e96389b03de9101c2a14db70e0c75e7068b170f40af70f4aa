import { RunToolApprovalItem } from './items';
import { UnknownContext } from './types';
import { Usage } from './usage';
type ApprovalRecord = {
    approved: boolean | string[];
    rejected: boolean | string[];
};
/**
 * A context object that is passed to the `Runner.run()` method.
 */
export declare class RunContext<TContext = UnknownContext> {
    #private;
    /**
     * The context object you passed to the `Runner.run()` method.
     */
    context: TContext;
    /**
     * The usage of the agent run so far. For streamed responses, the usage will be updated in real-time
     */
    usage: Usage;
    constructor(context?: TContext);
    /**
     * Check if a tool call has been approved.
     *
     * @param approval - Details about the tool call being evaluated.
     * @returns `true` if the tool call has been approved, `false` if blocked and `undefined` if not yet approved or rejected.
     */
    isToolApproved(approval: {
        toolName: string;
        callId: string;
    }): boolean | undefined;
    /**
     * Approve a tool call.
     *
     * @param approvalItem - The tool approval item to approve.
     * @param options - Additional approval behavior options.
     */
    approveTool(approvalItem: RunToolApprovalItem, { alwaysApprove }?: {
        alwaysApprove?: boolean;
    }): void;
    /**
     * Reject a tool call.
     *
     * @param approvalItem - The tool approval item to reject.
     */
    rejectTool(approvalItem: RunToolApprovalItem, { alwaysReject }?: {
        alwaysReject?: boolean;
    }): void;
    toJSON(): {
        context: any;
        usage: Usage;
        approvals: Record<string, ApprovalRecord>;
    };
}
export {};
