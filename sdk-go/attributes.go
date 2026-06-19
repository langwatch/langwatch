package langwatch

import "go.opentelemetry.io/otel/attribute"

// LangWatch span/trace attribute keys.
//
// These mirror the TypeScript SDK's semconv/attributes.ts and the server's
// canonical ingestion keys (app-layer/traces/canonicalisation extractors). Keys
// in the langwatch.* namespace are either owned by LangWatch or not yet part of
// the OpenTelemetry GenAI semantic conventions. GenAI semconv keys (gen_ai.*)
// come from go.opentelemetry.io/otel/semconv and are not duplicated here.
const (
	AttributeLangWatchInput        = attribute.Key("langwatch.input")
	AttributeLangWatchOutput       = attribute.Key("langwatch.output")
	AttributeLangWatchInstructions = attribute.Key("langwatch.instructions")
	AttributeLangWatchSpanType     = attribute.Key("langwatch.span.type")

	// AttributeLangWatchRAGContexts is the canonical RAG contexts key. The
	// pre-0.3 Go SDK emitted "langwatch.contexts", which the server does NOT
	// recognise — this is the corrected key, matching the TypeScript SDK and the
	// server's canonicalisation layer.
	AttributeLangWatchRAGContexts = attribute.Key("langwatch.rag.contexts")

	AttributeLangWatchMetrics    = attribute.Key("langwatch.metrics")
	AttributeLangWatchTimestamps = attribute.Key("langwatch.timestamps")
	AttributeLangWatchParams     = attribute.Key("langwatch.params")
	AttributeLangWatchStreaming  = attribute.Key("langwatch.gen_ai.streaming")

	AttributeLangWatchSDKVersion  = attribute.Key("langwatch.sdk.version")
	AttributeLangWatchSDKName     = attribute.Key("langwatch.sdk.name")
	AttributeLangWatchSDKLanguage = attribute.Key("langwatch.sdk.language")

	// Trace-metadata reserved keys. The server hoists these from span level to
	// trace level (thread/user/customer identity, labels). They may also be set
	// inside the langwatch.metadata blob — see AttributeLangWatchMetadata.
	AttributeLangWatchThreadID   = attribute.Key("langwatch.thread.id")
	AttributeLangWatchUserID     = attribute.Key("langwatch.user.id")
	AttributeLangWatchCustomerID = attribute.Key("langwatch.customer.id")
	AttributeLangWatchLabels     = attribute.Key("langwatch.labels")

	// AttributeLangWatchMetadata is a JSON object whose reserved fields
	// (thread_id/user_id/customer_id/labels) are hoisted to trace identity and
	// whose remaining fields are hoisted as metadata.<key> trace attributes.
	AttributeLangWatchMetadata = attribute.Key("langwatch.metadata")

	// AttributeLangWatchTraceName is an explicit display name for the trace.
	AttributeLangWatchTraceName = attribute.Key("langwatch.trace.name")

	// MetadataPrefix namespaces custom trace metadata. The server hoists
	// metadata.<key> attributes to trace-level metadata. See SetTraceMetadata.
	MetadataPrefix = "metadata."

	// AttributeLangWatchEvaluationCustom names the span event the reactor reads
	// to sync custom evaluations to evaluation_runs.
	AttributeLangWatchEvaluationCustom = attribute.Key("langwatch.evaluation.custom")

	// Prompt-span identity (mirrors python-sdk attributes.py LangWatchPrompt*).
	//
	// PromptID carries either a bare prompt id ("prompt_4RXLJtB9Cj-OA1BaLpxWc")
	// or — preferred for trace-UI navigation — the combined "<handle>:<version>"
	// form (e.g. "pizza-prompt:6"). The TS consumer findPromptReferenceInAncestors
	// reads PromptID for the "Open in Prompts" deep-link target.
	AttributeLangWatchPromptID            = attribute.Key("langwatch.prompt.id")
	AttributeLangWatchPromptHandle        = attribute.Key("langwatch.prompt.handle")
	AttributeLangWatchPromptVersionID     = attribute.Key("langwatch.prompt.version.id")
	AttributeLangWatchPromptVersionNumber = attribute.Key("langwatch.prompt.version.number")
	// AttributeLangWatchPromptSelectedID attaches the selected prompt to the
	// trace; if set on multiple spans, the last one wins.
	AttributeLangWatchPromptSelectedID = attribute.Key("langwatch.prompt.selected.id")
	// PromptVariables is a JSON string of shape {"type":"json","value":{...}}
	// — same envelope as RecordInput. Reserved for Prompt.compile +
	// PromptApiService.get spans.
	AttributeLangWatchPromptVariables = attribute.Key("langwatch.prompt.variables")
	// PromptDraft signals that the executed prompt config diverges from the
	// saved version named by PromptID/Handle/Version*. The base identity
	// fields stay populated as the resume target; the trace-UI consumer
	// adds an "(unsaved edits)" suffix to the "Open in Prompts" affordance.
	AttributeLangWatchPromptDraft = attribute.Key("langwatch.prompt.draft")
)
