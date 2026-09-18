import { HostedMCPApprovalFunction } from '../tool';
import { UnknownContext } from './aliases';
/**
 * OpenAI providerData type definition
 */
export type HostedMCPTool<Context = UnknownContext> = {
    type: 'mcp';
    allowed_tools?: string[] | {
        tool_names: string[];
    };
} & ({
    server_label: string;
    server_url?: string;
    authorization?: string;
    headers?: Record<string, string>;
} | {
    server_label: string;
    connector_id: string;
    authorization?: string;
    headers?: Record<string, string>;
}) & ({
    require_approval?: 'never';
    on_approval?: never;
} | {
    require_approval: 'always' | {
        never?: {
            tool_names: string[];
        };
        always?: {
            tool_names: string[];
        };
    };
    on_approval?: HostedMCPApprovalFunction<Context>;
});
export type HostedMCPListTools = {
    id: string;
    server_label: string;
    tools: {
        input_schema: unknown;
        name: string;
        annotations?: unknown | null;
        description?: string | null;
    }[];
    error?: string | null;
};
export type HostedMCPCall = {
    id: string;
    arguments: string;
    name: string;
    server_label: string;
    connector_id?: string;
    error?: string | null;
};
export type HostedMCPApprovalRequest = {
    id: string;
    name: string;
    arguments: string;
    server_label: string;
};
export type HostedMCPApprovalResponse = {
    id?: string;
    approve: boolean;
    approval_request_id: string;
    reason?: string;
};
