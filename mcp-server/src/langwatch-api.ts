import { addDays } from "date-fns";
import type { LLMModeTrace } from "langwatch";

interface SearchTrace {
	traces: LLMModeTrace[];
}

interface GetLlmTraceByIdOptions {
	langWatchEndpoint?: string;
}

interface ListLLmTracesOptions {
	pageSize?: number;
	pageOffset?: number;
	timeTravelDays?: number;
	langWatchEndpoint?: string;
}

export const getLlmTraceById = async (authToken: string, id: string, opts?: GetLlmTraceByIdOptions): Promise<LLMModeTrace> => {
	const { langWatchEndpoint } = opts ?? {};

	const endpoint = langWatchEndpoint ?? "https://app.langwatch.ai";

	const url = new URL(`${endpoint}/api/trace/${id}`);
	url.searchParams.set("llmMode", "true");

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			"X-Auth-Token": authToken,
		},
	});

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error("Trace not found");
		}

		throw new Error(`Failed to get trace: ${response.statusText}`);
	}

	return await response.json() as Promise<LLMModeTrace>;
};

export const listLlmTraces = async (authToken: string, opts?: ListLLmTracesOptions): Promise<SearchTrace> => {
	const {
		pageSize = 10,
		pageOffset = 0,
		timeTravelDays = 1,
		langWatchEndpoint,
	} = opts ?? {};

	const endpoint = langWatchEndpoint ?? "https://app.langwatch.ai";

	const response = await fetch(`${endpoint}/api/trace/search`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Auth-Token": authToken,
		},
		body: JSON.stringify({
			startDate: addDays(new Date(), -timeTravelDays).toISOString(),
			endDate: addDays(new Date(), 1).toISOString(),
			llmMode: true,
			pageOffset,
			pageSize,
		}),
	});

	return await response.json() as Promise<SearchTrace>;
}
