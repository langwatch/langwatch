import { RequestUsageData, UsageData } from "./types/protocol.mjs";
/**
 * Usage details for a single API request.
 */
export class RequestUsage {
    /**
     * The number of input tokens used for this request.
     */
    inputTokens;
    /**
     * The number of output tokens used for this request.
     */
    outputTokens;
    /**
     * The total number of tokens sent and received for this request.
     */
    totalTokens;
    /**
     * Details about the input tokens used for this request.
     */
    inputTokensDetails;
    /**
     * Details about the output tokens used for this request.
     */
    outputTokensDetails;
    /**
     * The endpoint that produced this usage entry (e.g., responses.create, responses.compact).
     */
    endpoint;
    constructor(input) {
        this.inputTokens = input?.inputTokens ?? input?.input_tokens ?? 0;
        this.outputTokens = input?.outputTokens ?? input?.output_tokens ?? 0;
        this.totalTokens =
            input?.totalTokens ??
                input?.total_tokens ??
                this.inputTokens + this.outputTokens;
        const inputTokensDetails = input?.inputTokensDetails ?? input?.input_tokens_details;
        this.inputTokensDetails = inputTokensDetails
            ? inputTokensDetails
            : {};
        const outputTokensDetails = input?.outputTokensDetails ?? input?.output_tokens_details;
        this.outputTokensDetails = outputTokensDetails
            ? outputTokensDetails
            : {};
        if (typeof input?.endpoint !== 'undefined') {
            this.endpoint = input.endpoint;
        }
    }
}
/**
 * Tracks token usage and request counts for an agent run.
 */
export class Usage {
    /**
     * The number of requests made to the LLM API.
     */
    requests;
    /**
     * The number of input tokens used across all requests.
     */
    inputTokens;
    /**
     * The number of output tokens used across all requests.
     */
    outputTokens;
    /**
     * The total number of tokens sent and received, across all requests.
     */
    totalTokens;
    /**
     * Details about the input tokens used across all requests.
     */
    inputTokensDetails = [];
    /**
     * Details about the output tokens used across all requests.
     */
    outputTokensDetails = [];
    /**
     * List of per-request usage entries for detailed cost calculations.
     */
    requestUsageEntries;
    constructor(input) {
        if (typeof input === 'undefined') {
            this.requests = 0;
            this.inputTokens = 0;
            this.outputTokens = 0;
            this.totalTokens = 0;
            this.inputTokensDetails = [];
            this.outputTokensDetails = [];
            this.requestUsageEntries = undefined;
        }
        else {
            this.requests = input?.requests ?? 1;
            this.inputTokens = input?.inputTokens ?? input?.input_tokens ?? 0;
            this.outputTokens = input?.outputTokens ?? input?.output_tokens ?? 0;
            this.totalTokens =
                input?.totalTokens ??
                    input?.total_tokens ??
                    this.inputTokens + this.outputTokens;
            const inputTokensDetails = input?.inputTokensDetails ?? input?.input_tokens_details;
            if (Array.isArray(inputTokensDetails)) {
                this.inputTokensDetails = inputTokensDetails;
            }
            else {
                this.inputTokensDetails = inputTokensDetails
                    ? [inputTokensDetails]
                    : [];
            }
            const outputTokensDetails = input?.outputTokensDetails ?? input?.output_tokens_details;
            if (Array.isArray(outputTokensDetails)) {
                this.outputTokensDetails = outputTokensDetails;
            }
            else {
                this.outputTokensDetails = outputTokensDetails
                    ? [outputTokensDetails]
                    : [];
            }
            const requestUsageEntries = input?.requestUsageEntries ?? input?.request_usage_entries;
            const normalizedRequestUsageEntries = Array.isArray(requestUsageEntries)
                ? requestUsageEntries.map((entry) => entry instanceof RequestUsage ? entry : new RequestUsage(entry))
                : undefined;
            this.requestUsageEntries =
                normalizedRequestUsageEntries &&
                    normalizedRequestUsageEntries.length > 0
                    ? normalizedRequestUsageEntries
                    : undefined;
        }
    }
    add(newUsage) {
        this.requests += newUsage.requests ?? 0;
        this.inputTokens += newUsage.inputTokens ?? 0;
        this.outputTokens += newUsage.outputTokens ?? 0;
        this.totalTokens += newUsage.totalTokens ?? 0;
        if (newUsage.inputTokensDetails) {
            // The type does not allow undefined, but it could happen runtime
            this.inputTokensDetails.push(...newUsage.inputTokensDetails);
        }
        if (newUsage.outputTokensDetails) {
            // The type does not allow undefined, but it could happen runtime
            this.outputTokensDetails.push(...newUsage.outputTokensDetails);
        }
        if (Array.isArray(newUsage.requestUsageEntries) &&
            newUsage.requestUsageEntries.length > 0) {
            this.requestUsageEntries ??= [];
            this.requestUsageEntries.push(...newUsage.requestUsageEntries.map((entry) => entry instanceof RequestUsage ? entry : new RequestUsage(entry)));
        }
        else if (newUsage.requests === 1 && newUsage.totalTokens > 0) {
            this.requestUsageEntries ??= [];
            this.requestUsageEntries.push(new RequestUsage({
                inputTokens: newUsage.inputTokens,
                outputTokens: newUsage.outputTokens,
                totalTokens: newUsage.totalTokens,
                inputTokensDetails: newUsage.inputTokensDetails?.[0],
                outputTokensDetails: newUsage.outputTokensDetails?.[0],
            }));
        }
    }
}
export { RequestUsageData, UsageData };
//# sourceMappingURL=usage.mjs.map