import { RequestUsageData, UsageData } from './types/protocol';
type RequestUsageInput = Partial<RequestUsageData & {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details: object;
    output_tokens_details: object;
    endpoint?: string;
}>;
type UsageInput = Partial<UsageData & {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details: Record<string, number> | Array<Record<string, number>> | object;
    output_tokens_details: Record<string, number> | Array<Record<string, number>> | object;
    request_usage_entries: RequestUsageInput[];
}> & {
    requests?: number;
    requestUsageEntries?: RequestUsageInput[];
};
/**
 * Usage details for a single API request.
 */
export declare class RequestUsage {
    /**
     * The number of input tokens used for this request.
     */
    inputTokens: number;
    /**
     * The number of output tokens used for this request.
     */
    outputTokens: number;
    /**
     * The total number of tokens sent and received for this request.
     */
    totalTokens: number;
    /**
     * Details about the input tokens used for this request.
     */
    inputTokensDetails: Record<string, number>;
    /**
     * Details about the output tokens used for this request.
     */
    outputTokensDetails: Record<string, number>;
    /**
     * The endpoint that produced this usage entry (e.g., responses.create, responses.compact).
     */
    endpoint?: 'responses.create' | 'responses.compact' | (string & {});
    constructor(input?: RequestUsageInput);
}
/**
 * Tracks token usage and request counts for an agent run.
 */
export declare class Usage {
    /**
     * The number of requests made to the LLM API.
     */
    requests: number;
    /**
     * The number of input tokens used across all requests.
     */
    inputTokens: number;
    /**
     * The number of output tokens used across all requests.
     */
    outputTokens: number;
    /**
     * The total number of tokens sent and received, across all requests.
     */
    totalTokens: number;
    /**
     * Details about the input tokens used across all requests.
     */
    inputTokensDetails: Array<Record<string, number>>;
    /**
     * Details about the output tokens used across all requests.
     */
    outputTokensDetails: Array<Record<string, number>>;
    /**
     * List of per-request usage entries for detailed cost calculations.
     */
    requestUsageEntries: RequestUsage[] | undefined;
    constructor(input?: UsageInput);
    add(newUsage: Usage): void;
}
export { RequestUsageData, UsageData };
