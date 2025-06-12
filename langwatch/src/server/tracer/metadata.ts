import type { ReservedTraceMetadataMapping } from "./types";

export const openTelemetryToLangWatchMetadataMapping: ReservedTraceMetadataMapping = {
	"telemetry.sdk.language": "telemetry_sdk_language",
	"telemetry.sdk.name": "telemetry_sdk_name",
	"telemetry.sdk.version": "telemetry_sdk_version",

	"thread.id": "thread_id",
	"user.id": "user_id",
	"customer.id": "customer_id",
	"topic.id": "topic_id",
	"subtopic.id": "subtopic_id",
	"tag.tags": "labels",

	"langwatch.thread.id": "thread_id",
	"langwatch.customer.id": "customer_id",
	"langwatch.user.id": "user_id",
	"langwatch.sdk.language": "sdk_language",
	"langwatch.sdk.name": "sdk_name",
	"langwatch.sdk.version": "sdk_version",
}
