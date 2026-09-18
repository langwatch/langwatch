import { Handoff } from '../handoff';
import { RunItem, RunToolApprovalItem } from '../items';
import { Model, ModelSettings, Prompt, SerializedHandoff, SerializedTool } from '../model';
import { ApplyPatchTool, ComputerTool, FunctionTool, HostedMCPTool, ShellTool } from '../tool';
import { Tool } from '../tool';
import { AgentInputItem, UnknownContext } from '../types';
import * as protocol from '../types/protocol';
import { ModelInputData } from './conversation';
export type ToolRunHandoff = {
    toolCall: protocol.FunctionCallItem;
    handoff: Handoff<any, any>;
};
export type ToolRunFunction<TContext = UnknownContext> = {
    toolCall: protocol.FunctionCallItem;
    tool: FunctionTool<TContext>;
};
export type ToolRunComputer = {
    toolCall: protocol.ComputerUseCallItem;
    computer: ComputerTool<any, any>;
};
export type ToolRunShell = {
    toolCall: protocol.ShellCallItem;
    shell: ShellTool;
};
export type ToolRunApplyPatch = {
    toolCall: protocol.ApplyPatchCallItem;
    applyPatch: ApplyPatchTool;
};
export type ToolRunMCPApprovalRequest = {
    requestItem: RunToolApprovalItem;
    mcpTool: HostedMCPTool;
};
export type ProcessedResponse<TContext = UnknownContext> = {
    newItems: RunItem[];
    handoffs: ToolRunHandoff[];
    functions: ToolRunFunction<TContext>[];
    computerActions: ToolRunComputer[];
    shellActions: ToolRunShell[];
    applyPatchActions: ToolRunApplyPatch[];
    mcpApprovalRequests: ToolRunMCPApprovalRequest[];
    toolsUsed: string[];
    hasToolsOrApprovalsToRun(): boolean;
};
export type AgentArtifacts<TContext = UnknownContext> = {
    handoffs: Handoff<any, any>[];
    tools: Tool<TContext>[];
    serializedHandoffs: SerializedHandoff[];
    serializedTools: SerializedTool[];
    toolsExplicitlyProvided: boolean;
};
export type PreparedModelCall<TContext = UnknownContext> = AgentArtifacts<TContext> & {
    model: Model;
    explictlyModelSet: boolean;
    modelSettings: ModelSettings;
    modelInput: ModelInputData;
    prompt?: Prompt;
    previousResponseId?: string;
    conversationId?: string;
    sourceItems: (AgentInputItem | undefined)[];
    filterApplied: boolean;
    turnInput: AgentInputItem[];
};
export type { CallModelInputFilter, CallModelInputFilterArgs, FilterApplicationResult, } from './conversation';
export type { ModelInputData };
export type { AgentInputItemPool } from './items';
export type { PreparedInputWithSessionResult, SessionPersistenceTracker, } from './sessionPersistence';
