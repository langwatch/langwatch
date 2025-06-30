package events

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	otelog "go.opentelemetry.io/otel/log"
)

func TestSystemMessageRecord(t *testing.T) {
	tests := []struct {
		name       string
		systemName string
		params     SystemMessageRecordParams
		wantAttrs  map[string]string
		wantBody   map[string]interface{}
	}{
		{
			name:       "Basic system message with content",
			systemName: "openai",
			params: SystemMessageRecordParams{
				IncludeContent: true,
				Content:        "You are a helpful assistant",
				Role:           SystemMessageRoleSystem,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "You are a helpful assistant",
			},
		},
		{
			name:       "System message with custom role",
			systemName: "openai",
			params: SystemMessageRecordParams{
				IncludeContent: true,
				Content:        "Instructions for the model",
				Role:           SystemMessageRoleInstruction,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "Instructions for the model",
				"role":    "instruction",
			},
		},
		{
			name:       "System message without content",
			systemName: "openai",
			params: SystemMessageRecordParams{
				IncludeContent: false,
				Content:        "Hidden content",
				Role:           SystemMessageRoleDeveloper,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"role": "developer",
			},
		},
		{
			name:       "System message with default role only",
			systemName: "custom-ai",
			params: SystemMessageRecordParams{
				IncludeContent: false,
				Content:        "",
				Role:           SystemMessageRoleSystem,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "custom-ai",
			},
			wantBody: nil, // No body attributes when default role and no content
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := SystemMessageRecord(tt.systemName, tt.params)

			// Check event name
			assert.Equal(t, string(EventNameSystemMessage), record.EventName())

			// Check attributes
			assertRecordAttributes(t, record, tt.wantAttrs)

			// Check body
			assertRecordBody(t, record, tt.wantBody)
		})
	}
}

func TestUserMessageRecord(t *testing.T) {
	tests := []struct {
		name       string
		systemName string
		params     UserMessageRecordParams
		wantAttrs  map[string]string
		wantBody   map[string]interface{}
	}{
		{
			name:       "Basic user message",
			systemName: "openai",
			params: UserMessageRecordParams{
				IncludeContent: true,
				Content:        "What is the weather like?",
				Role:           UserMessageRoleUser,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "What is the weather like?",
			},
		},
		{
			name:       "Customer message with custom role",
			systemName: "openai",
			params: UserMessageRecordParams{
				IncludeContent: true,
				Content:        "I need help with my order",
				Role:           UserMessageRoleCustomer,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "I need help with my order",
				"role":    "customer",
			},
		},
		{
			name:       "User message without content",
			systemName: "openai",
			params: UserMessageRecordParams{
				IncludeContent: false,
				Content:        "Private message",
				Role:           UserMessageRoleUser,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := UserMessageRecord(tt.systemName, tt.params)

			assert.Equal(t, string(EventNameUserMessage), record.EventName())
			assertRecordAttributes(t, record, tt.wantAttrs)
			assertRecordBody(t, record, tt.wantBody)
		})
	}
}

func TestAssistantMessageRecord(t *testing.T) {
	tests := []struct {
		name       string
		systemName string
		params     AssistantMessageRecordParams
		wantAttrs  map[string]string
		wantBody   map[string]interface{}
	}{
		{
			name:       "Basic assistant message",
			systemName: "openai",
			params: AssistantMessageRecordParams{
				IncludeContent: true,
				Content:        "I can help you with that!",
				Role:           AssistantMessageRoleAssistant,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "I can help you with that!",
			},
		},
		{
			name:       "Bot message with custom role",
			systemName: "openai",
			params: AssistantMessageRecordParams{
				IncludeContent: true,
				Content:        "Bot response here",
				Role:           AssistantMessageRoleBot,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "Bot response here",
				"role":    "bot",
			},
		},
		{
			name:       "Assistant message with tool calls",
			systemName: "openai",
			params: AssistantMessageRecordParams{
				IncludeContent: true,
				Content:        "I'll check the weather for you",
				Role:           AssistantMessageRoleAssistant,
				ToolCalls: []ToolCallRecord{
					{
						ID:   "call_123",
						Type: AssistantMessageBodyToolCallTypeFunction,
						Function: ToolCallFunctionRecord{
							Name:      "get_weather",
							Arguments: `{"location": "New York"}`,
						},
					},
				},
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "I'll check the weather for you",
				"tool_calls": []interface{}{
					map[string]interface{}{
						"id":   "call_123",
						"type": "function",
						"function": map[string]interface{}{
							"name":      "get_weather",
							"arguments": `{"location": "New York"}`,
						},
					},
				},
			},
		},
		{
			name:       "Assistant message with tool calls but no content included",
			systemName: "openai",
			params: AssistantMessageRecordParams{
				IncludeContent: false,
				Content:        "Hidden content",
				Role:           AssistantMessageRoleAssistant,
				ToolCalls: []ToolCallRecord{
					{
						ID:   "call_456",
						Type: AssistantMessageBodyToolCallTypeFunction,
						Function: ToolCallFunctionRecord{
							Name:      "send_email",
							Arguments: `{"to": "user@example.com"}`,
						},
					},
				},
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"tool_calls": []interface{}{
					map[string]interface{}{
						"id":   "call_456",
						"type": "function",
						"function": map[string]interface{}{
							"name": "send_email",
							// arguments should be excluded when IncludeContent is false
						},
					},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := AssistantMessageRecord(tt.systemName, tt.params)

			assert.Equal(t, string(EventNameAssistantMessage), record.EventName())
			assertRecordAttributes(t, record, tt.wantAttrs)
			assertRecordBody(t, record, tt.wantBody)
		})
	}
}

func TestToolMessageRecord(t *testing.T) {
	tests := []struct {
		name       string
		systemName string
		params     ToolMessageRecordParams
		wantAttrs  map[string]string
		wantBody   map[string]interface{}
	}{
		{
			name:       "Basic tool message",
			systemName: "openai",
			params: ToolMessageRecordParams{
				IncludeContent: true,
				ID:             "call_123",
				Content:        "Weather data: 72°F, sunny",
				Role:           ToolMessageRoleTool,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "Weather data: 72°F, sunny",
			},
		},
		{
			name:       "Tool message with custom role",
			systemName: "openai",
			params: ToolMessageRecordParams{
				IncludeContent: true,
				ID:             "call_456",
				Content:        "Function result",
				Role:           ToolMessageRoleAssistant,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"content": "Function result",
				"role":    "assistant",
			},
		},
		{
			name:       "Tool message without content",
			systemName: "openai",
			params: ToolMessageRecordParams{
				IncludeContent: false,
				ID:             "call_789",
				Content:        "Hidden tool output",
				Role:           ToolMessageRoleTool,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := ToolMessageRecord(tt.systemName, tt.params)

			assert.Equal(t, string(EventNameToolMessage), record.EventName())
			assertRecordAttributes(t, record, tt.wantAttrs)
			assertRecordBody(t, record, tt.wantBody)
		})
	}
}

func TestChoiceRecord(t *testing.T) {
	tests := []struct {
		name       string
		systemName string
		params     ChoiceRecordParams
		wantAttrs  map[string]string
		wantBody   map[string]interface{}
	}{
		{
			name:       "Basic choice with stop finish reason",
			systemName: "openai",
			params: ChoiceRecordParams{
				IncludeContent: true,
				Message: ChoiceRecordMessage{
					Content: "Hello there!",
					Role:    AssistantMessageRoleAssistant,
				},
				Index:        0,
				FinishReason: ChoiceBodyFinishReasonStop,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"finish_reason": "stop",
				"index":         0,
				"message": map[string]interface{}{
					"content": "Hello there!",
				},
			},
		},
		{
			name:       "Choice with tool calls finish reason",
			systemName: "openai",
			params: ChoiceRecordParams{
				IncludeContent: true,
				Message: ChoiceRecordMessage{
					Content: "I'll help you with that",
					Role:    AssistantMessageRoleBot,
				},
				Index:        1,
				FinishReason: ChoiceBodyFinishReasonToolCalls,
				ToolCalls: []ToolCallRecord{
					{
						ID:   "call_abc",
						Type: AssistantMessageBodyToolCallTypeFunction,
						Function: ToolCallFunctionRecord{
							Name:      "calculate",
							Arguments: `{"expression": "2+2"}`,
						},
					},
				},
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"finish_reason": "tool_calls",
				"index":         1,
				"message": map[string]interface{}{
					"content": "I'll help you with that",
					"role":    "bot",
				},
				"tool_calls": []interface{}{
					map[string]interface{}{
						"id":   "call_abc",
						"type": "function",
						"function": map[string]interface{}{
							"name":      "calculate",
							"arguments": `{"expression": "2+2"}`,
						},
					},
				},
			},
		},
		{
			name:       "Choice without content",
			systemName: "openai",
			params: ChoiceRecordParams{
				IncludeContent: false,
				Message: ChoiceRecordMessage{
					Content: "Hidden message",
					Role:    AssistantMessageRoleAssistant,
				},
				Index:        2,
				FinishReason: ChoiceBodyFinishReasonLength,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"finish_reason": "length",
				"index":         2,
			},
		},
		{
			name:       "Choice with content filter finish reason",
			systemName: "openai",
			params: ChoiceRecordParams{
				IncludeContent: true,
				Message: ChoiceRecordMessage{
					Content: "",
					Role:    AssistantMessageRoleAssistant,
				},
				Index:        0,
				FinishReason: ChoiceBodyFinishReasonContentFilter,
			},
			wantAttrs: map[string]string{
				"gen_ai.system": "openai",
			},
			wantBody: map[string]interface{}{
				"finish_reason": "content_filter",
				"index":         0,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			record := ChoiceRecord(tt.systemName, tt.params)

			assert.Equal(t, string(EventNameChoice), record.EventName())
			assertRecordAttributes(t, record, tt.wantAttrs)
			assertRecordBody(t, record, tt.wantBody)
		})
	}
}

func TestCreateToolCallSlice(t *testing.T) {
	tests := []struct {
		name           string
		toolCalls      []ToolCallRecord
		includeContent bool
		want           []interface{}
	}{
		{
			name: "Single tool call with content",
			toolCalls: []ToolCallRecord{
				{
					ID:   "call_123",
					Type: AssistantMessageBodyToolCallTypeFunction,
					Function: ToolCallFunctionRecord{
						Name:      "get_weather",
						Arguments: `{"location": "SF"}`,
					},
				},
			},
			includeContent: true,
			want: []interface{}{
				map[string]interface{}{
					"id":   "call_123",
					"type": "function",
					"function": map[string]interface{}{
						"name":      "get_weather",
						"arguments": `{"location": "SF"}`,
					},
				},
			},
		},
		{
			name: "Single tool call without content",
			toolCalls: []ToolCallRecord{
				{
					ID:   "call_456",
					Type: AssistantMessageBodyToolCallTypeFunction,
					Function: ToolCallFunctionRecord{
						Name:      "send_email",
						Arguments: `{"to": "user@example.com"}`,
					},
				},
			},
			includeContent: false,
			want: []interface{}{
				map[string]interface{}{
					"id":   "call_456",
					"type": "function",
					"function": map[string]interface{}{
						"name": "send_email",
						// arguments should be excluded when includeContent is false
					},
				},
			},
		},
		{
			name: "Multiple tool calls",
			toolCalls: []ToolCallRecord{
				{
					ID:   "call_1",
					Type: AssistantMessageBodyToolCallTypeFunction,
					Function: ToolCallFunctionRecord{
						Name:      "func1",
						Arguments: `{"param": "value1"}`,
					},
				},
				{
					ID:   "call_2",
					Type: AssistantMessageBodyToolCallTypeFunction,
					Function: ToolCallFunctionRecord{
						Name:      "func2",
						Arguments: `{"param": "value2"}`,
					},
				},
			},
			includeContent: true,
			want: []interface{}{
				map[string]interface{}{
					"id":   "call_1",
					"type": "function",
					"function": map[string]interface{}{
						"name":      "func1",
						"arguments": `{"param": "value1"}`,
					},
				},
				map[string]interface{}{
					"id":   "call_2",
					"type": "function",
					"function": map[string]interface{}{
						"name":      "func2",
						"arguments": `{"param": "value2"}`,
					},
				},
			},
		},
		{
			name:           "Empty tool calls",
			toolCalls:      []ToolCallRecord{},
			includeContent: true,
			want:           []interface{}{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := createToolCallSlice(tt.toolCalls, tt.includeContent)
			require.Equal(t, otelog.KindSlice, result.Kind())

			slice := result.AsSlice()
			actualResult := make([]interface{}, len(slice))
			for i, item := range slice {
				actualResult[i] = extractValue(t, item)
			}

			assert.Equal(t, tt.want, actualResult)
		})
	}
}

// Helper functions for testing

func assertRecordAttributes(t *testing.T, record otelog.Record, wantAttrs map[string]string) {
	t.Helper()

	if len(wantAttrs) == 0 {
		return
	}

	record.WalkAttributes(func(kv otelog.KeyValue) bool {
		key := string(kv.Key)
		if expectedValue, exists := wantAttrs[key]; exists {
			assert.Equal(t, expectedValue, kv.Value.AsString(), "Attribute %s mismatch", key)
			delete(wantAttrs, key)
		}
		return true
	})

	// Check that all expected attributes were found
	assert.Empty(t, wantAttrs, "Missing expected attributes: %v", wantAttrs)
}

func assertRecordBody(t *testing.T, record otelog.Record, wantBody map[string]interface{}) {
	t.Helper()

	body := record.Body()
	if wantBody == nil {
		// Expect no body or empty body
		if body.Kind() != otelog.KindEmpty {
			t.Errorf("Expected empty body, got kind %v", body.Kind())
		}
		return
	}

	require.Equal(t, otelog.KindMap, body.Kind(), "Body should be a map")

	actualBody := extractMapValue(t, body.AsMap())
	assert.Equal(t, wantBody, actualBody)
}

func extractMapValue(t *testing.T, mapValue []otelog.KeyValue) map[string]interface{} {
	t.Helper()

	result := make(map[string]interface{})
	for _, kv := range mapValue {
		key := string(kv.Key)
		value := extractValue(t, kv.Value)
		if value != nil {
			result[key] = value
		}
	}
	return result
}

func extractValue(t *testing.T, value otelog.Value) interface{} {
	t.Helper()

	switch value.Kind() {
	case otelog.KindString:
		return value.AsString()
	case otelog.KindInt64:
		return int(value.AsInt64())
	case otelog.KindBool:
		return value.AsBool()
	case otelog.KindMap:
		return extractMapValue(t, value.AsMap())
	case otelog.KindSlice:
		slice := value.AsSlice()
		result := make([]interface{}, 0, len(slice))
		for _, item := range slice {
			result = append(result, extractValue(t, item))
		}
		return result
	case otelog.KindEmpty:
		return nil
	default:
		t.Errorf("Unsupported value kind: %v", value.Kind())
		return nil
	}
}
