import type { DeepPartial } from "~/utils/types";
import type { TraceForCollection } from "./types";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { createLogger } from "~/utils/logger";
import { log } from "console";

const logger = createLogger("langwatch.tracer.otel.logs");

const supportedScopeNames = [
	"org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
	"org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]

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
				if (!logRecord || !logRecord.traceId || !logRecord.spanId) {
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

				const trace = traceMap[traceId] ?? {
					traceId,
					spans: [],
					evaluations: [],
					reservedTraceMetadata: {},
					customMetadata: {},
				} satisfies TraceForCollection;

				const logString = logRecord.body.stringValue;
				const [identifier, content] = logString.split("\n", 2);
				if (!identifier || !content) {
					logger.info("received log with no identifier or content, rejecting");
					continue;
				}

				let jsonParsedContent: unknown;
				try {
					jsonParsedContent = JSON.parse(content);
				} catch (error) {
					logger.warn({
						identifier,
						error,
					}, "failed to parse log content as json, rejecting");
					continue;
				}

				switch (identifier) {
					case "Chat Model Completion:":
						trace.spans.push({
							span_id: spanId,
							trace_id: traceId,
							type: "span",
							output: {
								type: "json",
								value: jsonParsedContent as any,
							},
							timestamps: {
								ignore_timestamps_on_write: true,
								started_at: convertFromUnixNano(logRecord.timeUnixNano),
								finished_at: 0,
							},
						});
						break;
					
					case "Chat Model Prompt Content:":
						trace.spans.push({
							span_id: spanId,
							trace_id: traceId,
							type: "span",
							input: {
								type: "json",
								value: jsonParsedContent as any,
							},
							timestamps: {
								ignore_timestamps_on_write: true,
								started_at: convertFromUnixNano(logRecord.timeUnixNano),
								finished_at: 0,
							},
						});
					default:
						continue;
				}
			}
		}
	}

	return [];
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
