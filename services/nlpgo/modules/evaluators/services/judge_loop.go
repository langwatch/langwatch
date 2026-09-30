package services

import (
	"context"
	"encoding/json"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// completeJudge is one judge call as litellm_patch.py makes it: reasoning off
// for the models that refuse tools with it, the forced call, its refusal
// retry and its reminder. Spec: langevals-judge-reasoning-tool-compatibility.feature.
func completeJudge(ctx context.Context, models *Models, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	if len(req.Tools) > 0 && req.ReasoningEffort == "" && rules.JudgeToolReasoningOffModel(req.Model) {
		req.ReasoningEffort = "none"
	}
	resp, err := completeForcedJudge(ctx, models, req)
	if err != nil && len(req.Tools) > 0 && rules.IsJudgeToolReasoningConflict(err.Error()) {
		return resp, &vendorFailure{errorType: "ToolReasoningConflictError", details: rules.JudgeToolReasoningConflictMessage(req.Model)}
	}
	return resp, err
}

// completeForcedJudge retries a refused forced tool_choice with "auto", and a
// forced call that left a required field out once more with a reminder.
// ponytail: refusers are not remembered across entries (Python keeps a process-wide set), so each pays its refused call.
func completeForcedJudge(ctx context.Context, models *Models, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	forced := len(req.Tools) > 0 && rules.IsForcedJudgeToolChoice(req.ToolChoice)
	name := rules.ForcedJudgeToolName(req.ToolChoice, req.Tools)
	resp, err := models.Complete(ctx, req)
	if err != nil && forced && rules.IsForcedJudgeToolChoiceRefusal(err.Error()) {
		return completeAutoToolChoiceJudge(ctx, models, req)
	}
	if err != nil || !forced || !judgeCallsTool(resp, name) || judgeCallsToolCompletely(resp, req.Tools, name) {
		return resp, err
	}
	return models.Complete(ctx, withJudgeReminder(req, name))
}

// completeAutoToolChoiceJudge is auto_tool_choice_attempts: "auto", then once
// more with a reminder when that answer skipped the function or a field.
func completeAutoToolChoiceJudge(ctx context.Context, models *Models, req channels.CompletionRequest) (channels.CompletionResponse, error) {
	name := rules.ForcedJudgeToolName(req.ToolChoice, req.Tools)
	relaxed := req
	relaxed.ToolChoice = json.RawMessage(`"auto"`)
	resp, err := models.Complete(ctx, relaxed)
	if err != nil || judgeCallsToolCompletely(resp, req.Tools, name) {
		return resp, err
	}
	return models.Complete(ctx, withJudgeReminder(relaxed, name))
}

func withJudgeReminder(req channels.CompletionRequest, name string) channels.CompletionRequest {
	reminder := channels.Message{Role: "user", Content: rules.JudgeToolReminder(name, rules.JudgeToolRequired(req.Tools, name))}
	req.Messages = append(append([]channels.Message{}, req.Messages...), reminder)
	return req
}

func judgeToolCalls(resp channels.CompletionResponse) []channels.ToolCall {
	if len(resp.Choices) == 0 {
		return nil
	}
	return resp.Choices[0].ToolCalls
}

// judgeCallsTool is calls_tool; a call with no name counts as the named one.
func judgeCallsTool(resp channels.CompletionResponse, name string) bool {
	for _, call := range judgeToolCalls(resp) {
		if name == "" || call.Name == name || call.Name == "" {
			return true
		}
	}
	return false
}

// judgeCallsToolCompletely is calls_tool_completely: the first matching call
// is a JSON object carrying every field its schema requires.
func judgeCallsToolCompletely(resp channels.CompletionResponse, tools []json.RawMessage, name string) bool {
	for _, call := range judgeToolCalls(resp) {
		if name != "" && call.Name != name && call.Name != "" {
			continue
		}
		schema := name
		if schema == "" {
			schema = call.Name
		}
		_, problem := rules.ReadJudgeArguments(call.Arguments, rules.JudgeToolRequired(tools, schema))
		return problem == ""
	}
	return false
}

// judgeAnswer is the verdict function a judge reads, and the model its
// errors name (the settings' model, as Python's do).
type judgeAnswer struct {
	tool     string
	required []string
	model    string
}

// read is read_tool_call_arguments: the verdict call's arguments, or a
// JudgeAnswerError.
func (a judgeAnswer) read(resp channels.CompletionResponse) (map[string]any, error) {
	if len(resp.Choices) == 0 {
		return nil, a.fail("returned no answer")
	}
	var matching []channels.ToolCall
	for _, call := range resp.Choices[0].ToolCalls {
		if call.Name == a.tool || call.Name == "" {
			matching = append(matching, call)
		}
	}
	if len(matching) == 0 && resp.Choices[0].FinishReason == "content_filter" {
		return nil, a.fail("refused to answer (content filter)")
	}
	if len(matching) == 0 {
		return nil, a.fail("answered without calling the function")
	}
	arguments, problem := rules.ReadJudgeArguments(matching[0].Arguments, a.required)
	if problem != "" {
		return nil, a.fail(problem)
	}
	return arguments, nil
}

func (a judgeAnswer) fail(problem string) error {
	return &vendorFailure{errorType: "JudgeAnswerError", details: rules.JudgeAnswerMessage(a.tool, problem, a.model)}
}

// judgeToolSpec is an OpenAI function tool, rendered as the Python dict literal.
type judgeToolSpec struct {
	name        string
	description string
	properties  map[string]any
	required    []string
}

func (spec judgeToolSpec) render() json.RawMessage {
	function := map[string]any{
		"name":       spec.name,
		"parameters": map[string]any{"type": "object", "properties": spec.properties, "required": spec.required},
	}
	if spec.description != "" {
		function["description"] = spec.description
	}
	tool, _ := json.Marshal(map[string]any{"type": "function", "function": function})
	return tool
}

// forcedJudgeToolChoice forces the named function.
func forcedJudgeToolChoice(name string) json.RawMessage {
	choice, _ := json.Marshal(map[string]any{"type": "function", "function": map[string]any{"name": name}})
	return choice
}

func judgeProperty(kind, description string) map[string]any {
	return map[string]any{"type": kind, "description": description}
}
