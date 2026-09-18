import type { ShellAction as ProtocolShellAction, ShellCallOutputContent } from './types/protocol';
/**
 * Describes the work to perform when executing a shell tool call.
 * Re-export protocol type to keep a single source of truth.
 */
export type ShellAction = ProtocolShellAction;
/**
 * Result returned by a shell tool implementation.
 */
/**
 * Output for a single executed command.
 */
export type ShellOutputResult = ShellCallOutputContent;
export type ShellResult = {
    /**
     * One entry per executed command (or logical chunk) in order.
     */
    output: ShellOutputResult[];
    /**
     * If you applied truncation yourself, set the limit you enforced for telemetry.
     */
    maxOutputLength?: number;
    /**
     * Optional provider-specific metadata merged into the tool call output.
     */
    providerData?: Record<string, unknown>;
};
/**
 * Executes shell commands on behalf of the agent.
 */
export interface Shell {
    /**
     * Runs the given action and returns the resulting output.
     */
    run(action: ShellAction): Promise<ShellResult>;
}
