import type { DeepPartial } from "~/utils/types";
import type { SpanInputOutput } from "./types";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { createLogger } from "~/utils/logger";
import type { TraceForCollection } from "./otel.traces";

const logger = createLogger("langwatch.tracer.otel.logs");

const supportedScopeNames = [
	"org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
	"org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
];

export const openTelemetryLogsRequestToTracesForCollection = (
	otelLogs: DeepPartial<IExportLogsServiceRequest>
): TraceForCollection[] => {
	if (!otelLogs.resourceLogs) {
		return [];
	}

	const traceMap: Record<string, TraceForCollection> = {};

	for (const resourceLog of otelLogs.resourceLogs) {
		if (!resourceLog?.scopeLogs) {
			continue;
		}

		for (const scopeLog of resourceLog.scopeLogs) {
			if (!scopeLog?.logRecords) {
				continue;
			}

			for (const logRecord of scopeLog.logRecords) {
				if (!logRecord?.traceId || !logRecord.spanId) {
					continue;
				}
				if (!logRecord.body?.stringValue) {
					continue;
				}
				if (!supportedScopeNames.includes(scopeLog.scope?.name ?? "")) {
					continue;
				}

				const traceId = decodeOpenTelemetryId(logRecord.traceId);
				const spanId = decodeOpenTelemetryId(logRecord.spanId);
				if (!traceId || !spanId) {
					logger.info("received log with no span or trace id, rejecting");
					continue;
				}

				const logString = logRecord.body.stringValue;
				const [identifier, ...contentParts] = logString.split("\n");
				const content = contentParts.join("\n");
				
				if (!identifier || !content) {
					logger.info("received log with no identifier or content, rejecting");
					continue;
				}

				let input: SpanInputOutput | null = null;
				let output: SpanInputOutput | null = null;

				switch (identifier) {
					case "Chat Model Completion:":
						output = {
							type: "text",
							value: content,
						};
						break;
					
					case "Chat Model Prompt Content:":
						input = {
							type: "text",
							value: content,
						};
						break;
					
					default:
						continue;
				}

				let trace = traceMap[traceId];
				if (!trace) {
					trace = {
						traceId,
						spans: [],
						evaluations: [],
						reservedTraceMetadata: {},
						customMetadata: {},
					} satisfies TraceForCollection;
					traceMap[traceId] = trace;
				}

				let existingSpan = trace.spans.find(span => span.span_id === spanId);
				if (!existingSpan) {
					existingSpan = {
						span_id: spanId,
						trace_id: traceId,
						name: identifier.replace(":", ""),
						type: "llm",
						input: input,
						output: output,
						params: {},
						timestamps: {
							ignore_timestamps_on_write: true,
							started_at: convertFromUnixNano(logRecord.timeUnixNano),
							finished_at: convertFromUnixNano(logRecord.timeUnixNano),
						},
					};
					trace.spans.push(existingSpan);
				} else {
					// For log record spans, preserve existing input/output if they exist
					if (input && !existingSpan.input) {
						existingSpan.input = input;
					}
					if (output && !existingSpan.output) {
						existingSpan.output = output;
					}
					// Ensure the preserve flag is set
					if (!existingSpan.params) {
						existingSpan.params = {};
					}
				}
			}
		}
	}

	return Object.values(traceMap);
}

const decodeOpenTelemetryId = (id: unknown): string | null => {
	if (typeof id === "string") {
		return id;
	}
	if (id && typeof id === "object" && id.constructor === Uint8Array) {
		return Buffer.from(id as Uint8Array).toString("hex");
	}

	return null;
}

const convertFromUnixNano = (timeUnixNano: unknown): number => {
	let unixNano: number;

	if (typeof timeUnixNano === "number") {
		unixNano = timeUnixNano;
	} else if (typeof timeUnixNano === "string") {
		const parsed = parseInt(timeUnixNano, 10);
		unixNano = !isNaN(parsed) ? parsed : Date.now() * 1000000;
	} else if (timeUnixNano && typeof timeUnixNano === "object" && "low" in timeUnixNano && "high" in timeUnixNano) {
		const { low = 0, high = 0 } = timeUnixNano as any;
		unixNano = high * 0x100000000 + low;
	} else {
		unixNano = Date.now() * 1000000;
	}
	
	// Convert nanoseconds to milliseconds
	return Math.round(unixNano / 1000000);
}
