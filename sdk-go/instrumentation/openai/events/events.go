package events

import (
	otelog "go.opentelemetry.io/otel/log"
)

type EventName string

type SystemMessageRole string
type UserMessageRole string
type AssistantMessageRole string
type ToolMessageRole string

type ToolCallType string

type ChoiceBodyFinishReason string

const (
	EventNameSystemMessage    EventName = "gen_ai.system.message"
	EventNameUserMessage      EventName = "gen_ai.user.message"
	EventNameAssistantMessage EventName = "gen_ai.assistant.message"
	EventNameToolMessage      EventName = "gen_ai.tool.message"
	EventNameChoice           EventName = "gen_ai.choice"

	SystemMessageRoleInstruction SystemMessageRole = "instruction"
	SystemMessageRoleSystem      SystemMessageRole = "system"
	SystemMessageRoleDeveloper   SystemMessageRole = "developer"

	UserMessageRoleCustomer UserMessageRole = "customer"
	UserMessageRoleUser     UserMessageRole = "user"

	AssistantMessageRoleAssistant AssistantMessageRole = "assistant"
	AssistantMessageRoleBot       AssistantMessageRole = "bot"

	ToolMessageRoleAssistant ToolMessageRole = "assistant"
	ToolMessageRoleTool      ToolMessageRole = "tool"

	AssistantMessageBodyToolCallTypeFunction ToolCallType = "function"

	ChoiceBodyFinishReasonContentFilter ChoiceBodyFinishReason = "content_filter"
	ChoiceBodyFinishReasonError         ChoiceBodyFinishReason = "error"
	ChoiceBodyFinishReasonLength        ChoiceBodyFinishReason = "length"
	ChoiceBodyFinishReasonStop          ChoiceBodyFinishReason = "stop"
	ChoiceBodyFinishReasonToolCalls     ChoiceBodyFinishReason = "tool_calls"
)

type SystemMessageRecordParams struct {
	IncludeContent bool
	Content        string
	Role           SystemMessageRole
}

type AssistantMessageRecordParams struct {
	IncludeContent bool
	Content        string
	Role           AssistantMessageRole
	ToolCalls      []ToolCallRecord
}

type UserMessageRecordParams struct {
	IncludeContent bool
	Content        string
	Role           UserMessageRole
}

type ToolMessageRecordParams struct {
	IncludeContent bool
	ID             string
	Content        string
	Role           ToolMessageRole
}

type ToolCallRecordParams struct {
	ID       string
	Type     ToolCallType
	Function ToolCallFunctionRecord
}

type ChoiceRecordParams struct {
	IncludeContent bool
	Message        ChoiceRecordMessage
	Index          int
	ToolCalls      []ToolCallRecord
	FinishReason   ChoiceBodyFinishReason
}

type ChoiceRecordMessage struct {
	Content string
	Role    AssistantMessageRole
}

type ToolCallRecord struct {
	ID       string
	Type     ToolCallType
	Function ToolCallFunctionRecord
}

type ToolCallFunctionRecord struct {
	Arguments string
	Name      string
}

func SystemMessageRecord(systemName string, params SystemMessageRecordParams) otelog.Record {
	rec := otelog.Record{}
	rec.SetEventName(string(EventNameSystemMessage))
	rec.AddAttributes(otelog.String("gen_ai.system", systemName))

	bodyAttributes := []otelog.KeyValue{}
	if params.Role != "" && params.Role != SystemMessageRoleSystem {
		bodyAttributes = append(bodyAttributes, otelog.String("role", string(params.Role)))
	}
	if params.IncludeContent {
		bodyAttributes = append(bodyAttributes, otelog.String("content", params.Content))
	}
	if len(bodyAttributes) > 0 {
		rec.SetBody(otelog.MapValue(bodyAttributes...))
	}

	return rec
}

func UserMessageRecord(systemName string, params UserMessageRecordParams) otelog.Record {
	rec := otelog.Record{}
	rec.SetEventName(string(EventNameUserMessage))
	rec.AddAttributes(otelog.String("gen_ai.system", systemName))

	bodyAttributes := []otelog.KeyValue{}
	if params.Role != "" && params.Role != UserMessageRoleUser {
		bodyAttributes = append(bodyAttributes, otelog.String("role", string(params.Role)))
	}
	if params.IncludeContent {
		bodyAttributes = append(bodyAttributes, otelog.String("content", params.Content))
	}
	if len(bodyAttributes) > 0 {
		rec.SetBody(otelog.MapValue(bodyAttributes...))
	}

	return rec
}

func AssistantMessageRecord(systemName string, params AssistantMessageRecordParams) otelog.Record {
	rec := otelog.Record{}
	rec.SetEventName(string(EventNameAssistantMessage))
	rec.AddAttributes(otelog.String("gen_ai.system", systemName))

	bodyAttributes := []otelog.KeyValue{}
	if params.Role != "" && params.Role != AssistantMessageRoleAssistant {
		bodyAttributes = append(bodyAttributes, otelog.String("role", string(params.Role)))
	}
	if params.IncludeContent {
		bodyAttributes = append(bodyAttributes, otelog.String("content", params.Content))
	}

	if len(params.ToolCalls) > 0 {
		bodyAttributes = append(bodyAttributes, otelog.KeyValue{
			Key:   "tool_calls",
			Value: createToolCallSlice(params.ToolCalls, params.IncludeContent),
		})
	}

	if len(bodyAttributes) > 0 {
		rec.SetBody(otelog.MapValue(bodyAttributes...))
	}

	return rec
}

func ToolMessageRecord(systemName string, params ToolMessageRecordParams) otelog.Record {
	rec := otelog.Record{}
	rec.SetEventName(string(EventNameToolMessage))
	rec.AddAttributes(otelog.String("gen_ai.system", systemName))

	bodyAttributes := []otelog.KeyValue{}
	if params.Role != "" && params.Role != ToolMessageRoleTool {
		bodyAttributes = append(bodyAttributes, otelog.String("role", string(params.Role)))
	}
	if params.IncludeContent {
		bodyAttributes = append(bodyAttributes, otelog.String("content", params.Content))
	}

	rec.SetBody(otelog.MapValue(bodyAttributes...))

	return rec
}

func ChoiceRecord(systemName string, params ChoiceRecordParams) otelog.Record {
	rec := otelog.Record{}
	rec.SetEventName(string(EventNameChoice))
	rec.AddAttributes(otelog.String("gen_ai.system", systemName))

	messageValues := []otelog.KeyValue{}
	if params.Message.Role != "" && params.Message.Role != AssistantMessageRoleAssistant {
		messageValues = append(messageValues, otelog.String("role", string(params.Message.Role)))
	}
	if params.Message.Content != "" && params.IncludeContent {
		messageValues = append(messageValues, otelog.String("content", params.Message.Content))
	}

	bodyAttributes := []otelog.KeyValue{
		otelog.String("finish_reason", string(params.FinishReason)),
		otelog.Int("index", params.Index),
	}
	if len(messageValues) > 0 {
		bodyAttributes = append(bodyAttributes, otelog.Map("message", messageValues...))
	}
	if len(params.ToolCalls) > 0 {
		bodyAttributes = append(bodyAttributes, otelog.KeyValue{
			Key:   "tool_calls",
			Value: createToolCallSlice(params.ToolCalls, params.IncludeContent),
		})
	}

	rec.SetBody(otelog.MapValue(bodyAttributes...))

	return rec
}

func createToolCallSlice(
	toolCalls []ToolCallRecord,
	includeContent bool,
) otelog.Value {
	toolCallValues := make([]otelog.Value, len(toolCalls))
	for i, toolCall := range toolCalls {
		functionValues := []otelog.KeyValue{
			otelog.String("name", toolCall.Function.Name),
		}
		if toolCall.Function.Arguments != "" && includeContent {
			functionValues = append(functionValues, otelog.String("arguments", toolCall.Function.Arguments))
		}

		toolCallKVs := []otelog.KeyValue{
			otelog.String("id", toolCall.ID),
			otelog.String("type", string(toolCall.Type)),
			otelog.KeyValue{
				Key:   "function",
				Value: otelog.MapValue(functionValues...),
			},
		}

		toolCallValues[i] = otelog.MapValue(toolCallKVs...)
	}
	return otelog.SliceValue(toolCallValues...)
}
