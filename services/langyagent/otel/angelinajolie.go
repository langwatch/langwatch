// Package otel builds LangWatch's own content-free copy of Langy worker traces.
package otel

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

const (
	attrServiceName  = "service.name"
	attrOrigin       = "langwatch.origin"
	attrConversation = "langy.conversation_id"

	serviceName       = "langwatch-langyworker"
	originWorker      = "langy_worker"
	internalScopeName = "langwatch.langyworker"
	internalSpanName  = "langy.worker"
)

// Numeric attributes cannot carry customer text. Their values are copied only
// when the worker used the expected numeric type and supplied a non-negative
// value. Everything else is omitted from LangWatch's copy.
var safeIntSpanAttributes = map[string]struct{}{
	"gen_ai.usage.input_tokens":                {},
	"gen_ai.usage.output_tokens":               {},
	"gen_ai.usage.total_tokens":                {},
	"gen_ai.usage.cache_read.input_tokens":     {},
	"gen_ai.usage.cache_creation.input_tokens": {},
	"http.response.status_code":                {},
}

// String metadata is retained only when it belongs to a closed operational
// vocabulary. Open-ended strings such as model ids and tool names are never
// trusted from the worker; the model is stamped from manager-owned config.
var safeEnumSpanAttributes = map[string]map[string]struct{}{
	"gen_ai.operation.name": enumSet(
		"chat", "text_completion", "embeddings", "execute_tool", "generate_content",
	),
	"gen_ai.system": enumSet(
		"anthropic", "aws.bedrock", "azure.ai.openai", "gcp.vertex_ai", "openai",
	),
	"gen_ai.tool.type": enumSet("datastore", "extension", "function"),
	"http.request.method": enumSet(
		"CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE",
	),
}

var safeFinishReasons = enumSet(
	"content_filter", "error", "length", "stop", "tool_calls", "unknown",
)

func enumSet(values ...string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		out[value] = struct{}{}
	}
	return out
}

// InternalCopy returns a new trace batch containing only operational metadata
// that is safe for LangWatch's collector. It deliberately constructs a blank
// OTLP tree instead of cloning the worker payload: newly-added pdata string
// fields therefore stay empty until explicitly reviewed here.
//
// trustedModel and conversationID come from manager-owned worker registration,
// never from the worker's OTLP payload. td is not modified.
func InternalCopy(
	td ptrace.Traces,
	conversationID string,
	trustedModel string,
	turn trace.SpanContext,
) ptrace.Traces {
	out := ptrace.NewTraces()
	sourceResources := td.ResourceSpans()
	for i := 0; i < sourceResources.Len(); i++ {
		sourceResource := sourceResources.At(i)
		destinationResource := out.ResourceSpans().AppendEmpty()
		stampInternalResource(destinationResource.Resource().Attributes(), conversationID)

		sourceScopes := sourceResource.ScopeSpans()
		for j := 0; j < sourceScopes.Len(); j++ {
			sourceScope := sourceScopes.At(j)
			destinationScope := destinationResource.ScopeSpans().AppendEmpty()
			destinationScope.Scope().SetName(internalScopeName)

			sourceSpans := sourceScope.Spans()
			for k := 0; k < sourceSpans.Len(); k++ {
				copySafeSpan(
					sourceSpans.At(k),
					destinationScope.Spans().AppendEmpty(),
					trustedModel,
					turn,
				)
			}
		}
	}
	return out
}

func stampInternalResource(attrs pcommon.Map, conversationID string) {
	attrs.PutStr(attrServiceName, serviceName)
	attrs.PutStr(attrOrigin, originWorker)
	attrs.PutStr(attrConversation, conversationID)
}

func copySafeSpan(source, destination ptrace.Span, trustedModel string, turn trace.SpanContext) {
	destination.SetName(internalSpanName)
	destination.SetTraceID(source.TraceID())
	destination.SetSpanID(source.SpanID())
	destination.SetParentSpanID(source.ParentSpanID())
	destination.SetStartTimestamp(source.StartTimestamp())
	destination.SetEndTimestamp(source.EndTimestamp())
	destination.SetKind(source.Kind())
	destination.SetFlags(source.Flags())
	destination.Status().SetCode(source.Status().Code())

	copySafeAttributes(source.Attributes(), destination.Attributes(), trustedModel)
	copySafeLinks(source.Links(), destination.Links())

	if turn.IsValid() {
		destination.SetTraceID(pcommon.TraceID(turn.TraceID()))
		if destination.ParentSpanID().IsEmpty() {
			destination.SetParentSpanID(pcommon.SpanID(turn.SpanID()))
		}
	}
}

func copySafeAttributes(source, destination pcommon.Map, trustedModel string) {
	source.Range(func(key string, value pcommon.Value) bool {
		if _, ok := safeIntSpanAttributes[key]; ok {
			copySafeInt(destination, key, value)
			return true
		}
		if vocabulary, ok := safeEnumSpanAttributes[key]; ok {
			copySafeEnum(destination, key, value, vocabulary)
			return true
		}
		if key == "gen_ai.response.finish_reasons" {
			copySafeEnumSlice(destination, key, value, safeFinishReasons)
			return true
		}
		if (key == "gen_ai.request.model" || key == "gen_ai.response.model") && trustedModel != "" {
			destination.PutStr(key, trustedModel)
		}
		return true
	})
}

func copySafeInt(destination pcommon.Map, key string, value pcommon.Value) {
	if value.Type() != pcommon.ValueTypeInt || value.Int() < 0 {
		return
	}
	if key == "http.response.status_code" && (value.Int() < 100 || value.Int() > 599) {
		return
	}
	destination.PutInt(key, value.Int())
}

func copySafeEnum(
	destination pcommon.Map,
	key string,
	value pcommon.Value,
	vocabulary map[string]struct{},
) {
	if value.Type() != pcommon.ValueTypeStr {
		return
	}
	canonical := strings.TrimSpace(value.Str())
	if _, ok := vocabulary[canonical]; ok {
		destination.PutStr(key, canonical)
	}
}

func copySafeEnumSlice(
	destination pcommon.Map,
	key string,
	value pcommon.Value,
	vocabulary map[string]struct{},
) {
	if value.Type() != pcommon.ValueTypeSlice {
		return
	}
	source := value.Slice()
	safe := make([]string, 0, source.Len())
	for i := 0; i < source.Len(); i++ {
		item := source.At(i)
		if item.Type() != pcommon.ValueTypeStr {
			return
		}
		if _, ok := vocabulary[item.Str()]; !ok {
			return
		}
		safe = append(safe, item.Str())
	}
	if len(safe) == 0 {
		return
	}
	destinationSlice := destination.PutEmptySlice(key)
	for _, item := range safe {
		destinationSlice.AppendEmpty().SetStr(item)
	}
}

func copySafeLinks(source, destination ptrace.SpanLinkSlice) {
	for i := 0; i < source.Len(); i++ {
		sourceLink := source.At(i)
		destinationLink := destination.AppendEmpty()
		destinationLink.SetTraceID(sourceLink.TraceID())
		destinationLink.SetSpanID(sourceLink.SpanID())
		destinationLink.SetFlags(sourceLink.Flags())
	}
}
