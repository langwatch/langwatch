import { Agent } from '../agent';
import { RunItem, RunToolApprovalItem } from '../items';
import { Logger } from '../logger';
import { FunctionToolResult } from '../tool';
import { RunContext } from '../runContext';
import type { UnknownContext } from '../types';
import type { Runner } from '../run';
import type { ToolRunApplyPatch, ToolRunShell } from './types';
export declare function executeShellActions(agent: Agent<any, any>, actions: ToolRunShell[], runner: Runner, runContext: RunContext, customLogger?: Logger | undefined): Promise<RunItem[]>;
export declare function executeApplyPatchOperations(agent: Agent<any, any>, actions: ToolRunApplyPatch[], runner: Runner, runContext: RunContext, customLogger?: Logger | undefined): Promise<RunItem[]>;
/**
 * Collects approval interruptions from tool execution results and any additional
 * RunItems (e.g., shell/apply_patch approval placeholders).
 */
export declare function collectInterruptions<TContext = UnknownContext>(toolResults: FunctionToolResult<TContext>[], additionalItems?: RunItem[]): RunToolApprovalItem[];
