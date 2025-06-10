package langwatch

import "go.opentelemetry.io/otel/attribute"

const (
	AttributeLangWatchInput       = attribute.Key("langwatch.input")
	AttributeLangWatchPrompt      = attribute.Key("langwatch.prompt")
	AttributeLangWatchOutput      = attribute.Key("langwatch.output")
	AttributeLangWatchSpanType    = attribute.Key("langwatch.span.type")
	AttributeLangWatchRAGContexts = attribute.Key("langwatch.contexts")
	AttributeLangWatchSDKVersion  = attribute.Key("langwatch.sdk.version")
	AttributeLangWatchSDKName     = attribute.Key("langwatch.sdk.name")
	AttributeLangWatchSDKLanguage = attribute.Key("langwatch.sdk.language")
	AttributeLangWatchTimestamps  = attribute.Key("langwatch.timestamps")
	AttributeLangWatchParams      = attribute.Key("langwatch.params")
	AttributeLangWatchCustomerID  = attribute.Key("langwatch.customer.id")
	AttributeLangWatchThreadID    = attribute.Key("langwatch.thread.id")
	AttributeLangWatchStreaming   = attribute.Key("langwatch.gen_ai.streaming")
)
