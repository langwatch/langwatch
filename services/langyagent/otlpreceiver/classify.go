package otlpreceiver

import "strings"

// genAIPrefix marks a span as gen-AI-shaped under OTel's semconv: any
// `gen_ai.*` attribute at all (system, request.model, usage.input_tokens, ...).
const genAIPrefix = "gen_ai."

// toolMarkerKeys are the attributes that make a span a TOOL call rather than a
// model call. This list is checked FIRST, because tool spans in the gen-AI
// semconv also carry `gen_ai.*` attributes (`gen_ai.tool.name`,
// `gen_ai.operation.name=execute_tool`) and would otherwise classify as llm.
var toolMarkerKeys = []string{
	"gen_ai.tool.name",
	"gen_ai.tool.call.id",
	"tool.name",
	"tool_name",
}

// toolOperationValues are the values of `gen_ai.operation.name` that mean "this
// span executed a tool".
var toolOperationValues = map[string]struct{}{
	"execute_tool": {},
	"tool":         {},
}

// classify buckets a span into the coarse Kind the UI branches on. The rules,
// in order:
//
//  1. tool  — a tool-marker attribute, `gen_ai.operation.name` in the tool set,
//     or a name prefixed `execute_tool` / `tool.`.
//  2. llm   — any `gen_ai.*` attribute survives to here, so it is a model call.
//  3. other — everything else.
//
// Deliberately shallow and order-sensitive. If a span looks like both, tool
// wins: a tool execution that reports its model is still a tool execution.
func classify(name string, attrs map[string]any) Kind {
	for _, key := range toolMarkerKeys {
		if _, ok := attrs[key]; ok {
			return KindTool
		}
	}
	if op, ok := attrs["gen_ai.operation.name"].(string); ok {
		if _, isTool := toolOperationValues[strings.ToLower(op)]; isTool {
			return KindTool
		}
	}

	lower := strings.ToLower(name)
	if strings.HasPrefix(lower, "execute_tool") || strings.HasPrefix(lower, "tool.") {
		return KindTool
	}

	for key := range attrs {
		if strings.HasPrefix(key, genAIPrefix) {
			return KindLLM
		}
	}
	return KindOther
}
