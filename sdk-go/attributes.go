package langwatch

import "go.opentelemetry.io/otel/attribute"

const (
	AttributeLangWatchInput        = attribute.Key("langwatch.input")
	AttributeLangWatchInstructions = attribute.Key("langwatch.instructions")
	AttributeLangWatchOutput       = attribute.Key("langwatch.output")
	AttributeLangWatchSpanType     = attribute.Key("langwatch.span.type")
	AttributeLangWatchRAGContexts  = attribute.Key("langwatch.contexts")
	AttributeLangWatchSDKVersion   = attribute.Key("langwatch.sdk.version")
	AttributeLangWatchSDKName      = attribute.Key("langwatch.sdk.name")
	AttributeLangWatchSDKLanguage  = attribute.Key("langwatch.sdk.language")
	AttributeLangWatchTimestamps   = attribute.Key("langwatch.timestamps")
	AttributeLangWatchParams       = attribute.Key("langwatch.params")
	AttributeLangWatchCustomerID   = attribute.Key("langwatch.customer.id")
	AttributeLangWatchThreadID     = attribute.Key("langwatch.thread.id")
	AttributeLangWatchStreaming    = attribute.Key("langwatch.gen_ai.streaming")

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
