package rules

import (
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
)

// JudgeToolReasoningOffModel is litellm_patch.py's
// TOOL_REASONING_INCOMPATIBLE_MODELS: tools are refused while reasoning is on.
func JudgeToolReasoningOffModel(model string) bool {
	switch model {
	case "openai/gpt-5.6-luna", "openai/gpt-5.6-sol", "openai/gpt-5.6-terra":
		return true
	}
	return false
}

// IsForcedJudgeToolChoice is is_forced_tool_choice: an object, "required" or "any".
func IsForcedJudgeToolChoice(toolChoice json.RawMessage) bool {
	var choice any
	if json.Unmarshal(toolChoice, &choice) != nil {
		return false
	}
	switch value := choice.(type) {
	case map[string]any:
		return true
	case string:
		return value == "required" || value == "any"
	}
	return false
}

type judgeToolSchema struct {
	Name     string `json:"name"`
	Function *struct {
		Name       string `json:"name"`
		Parameters struct {
			Required []string `json:"required"`
		} `json:"parameters"`
	} `json:"function"`
}

// ForcedJudgeToolName is forced_tool_name: the one function a forced
// tool_choice names, or "" for any tool.
func ForcedJudgeToolName(toolChoice json.RawMessage, tools []json.RawMessage) string {
	var object map[string]json.RawMessage
	if json.Unmarshal(toolChoice, &object) == nil && object != nil {
		var choice judgeToolSchema
		_ = json.Unmarshal(toolChoice, &choice)
		if choice.Function != nil && choice.Function.Name != "" {
			return choice.Function.Name
		}
		return choice.Name
	}
	if len(tools) == 1 {
		var tool judgeToolSchema
		if json.Unmarshal(tools[0], &tool) == nil && tool.Function != nil {
			return tool.Function.Name
		}
	}
	return ""
}

// JudgeToolRequired is required_fields: what the named tool's schema requires;
// "" names the first tool.
func JudgeToolRequired(tools []json.RawMessage, name string) []string {
	for _, raw := range tools {
		var tool judgeToolSchema
		if json.Unmarshal(raw, &tool) != nil || tool.Function == nil {
			continue
		}
		if name == "" || tool.Function.Name == name {
			return tool.Function.Parameters.Required
		}
	}
	return nil
}

// JudgeToolReminder is TOOL_CALL_REMINDER, sent after a forced call that
// skipped a required field.
func JudgeToolReminder(name string, required []string) string {
	if name == "" {
		name = "provided"
	}
	fields := strings.Join(required, ", ")
	if fields == "" {
		fields = "all of them"
	}
	return "Answer only by calling the `" + name + "` function, with every required field (" + fields + ") as its own argument. Write no tags or other fields inside a text field."
}

// IsForcedJudgeToolChoiceRefusal is forced_tool_choice_refused's reading of
// the provider's error.
func IsForcedJudgeToolChoiceRefusal(message string) bool {
	lower := strings.ToLower(message)
	if !strings.Contains(lower, "tool_choice") {
		return false
	}
	for _, marker := range []string{"not supported", "thinking", "forces tool use", "not compatible"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// IsJudgeToolReasoningConflict is tool_reasoning_conflict's reading of a
// rejection of a request that carried tools.
func IsJudgeToolReasoningConflict(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "reasoning_effort") && strings.Contains(lower, "tool")
}

// JudgeToolReasoningConflictMessage is ToolReasoningConflictError's message.
func JudgeToolReasoningConflictMessage(model string) string {
	return judgeSubject(model) + " does not accept function tools while its reasoning is on, and this evaluator asks for its verdict through a function call. Choose a different evaluator model, or set its reasoning effort to 'none'."
}

// JudgeAnswerMessage is JudgeAnswerError's message.
func JudgeAnswerMessage(tool, problem, model string) string {
	return judgeSubject(model) + " " + problem + ", so no verdict could be read from the `" + tool + "` function call. Retry the evaluation, or choose an evaluator model that supports function calling."
}

func judgeSubject(model string) string {
	if model == "" {
		return "The evaluator model"
	}
	return "The evaluator model " + model
}

// ReadJudgeArguments decodes a tool call's arguments as Python's json.loads,
// numbers kept as written. problem is read_tool_call_arguments' wording.
func ReadJudgeArguments(raw string, required []string) (arguments map[string]any, problem string) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil || !errors.Is(decoder.Decode(&struct{}{}), io.EOF) {
		return nil, "sent function arguments that are not valid JSON"
	}
	arguments, ok := value.(map[string]any)
	if !ok {
		return nil, "sent function arguments that are not an object"
	}
	var missing []string
	for _, field := range required {
		if arguments[field] == nil {
			missing = append(missing, field)
		}
	}
	if len(missing) > 0 {
		return nil, "left out the required field(s) " + strings.Join(missing, ", ")
	}
	return arguments, ""
}

// JudgeBoolean is read_boolean: a bool, or the strings "true"/"false".
func JudgeBoolean(value any) (verdict, ok bool) {
	switch v := value.(type) {
	case bool:
		return v, true
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true":
			return true, true
		case "false":
			return false, true
		}
	}
	return false, false
}

// JudgeFloat is Python's float() over a decoded argument.
func JudgeFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f, err == nil
	case bool:
		return boolFloat(v), true
	}
	return 0, false
}

func boolFloat(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

// JudgeText is Python's str() of a decoded argument, as an f-string prints it.
func JudgeText(value any) string {
	switch v := value.(type) {
	case nil:
		return "None"
	case bool:
		if v {
			return "True"
		}
		return "False"
	case string:
		return v
	case json.Number:
		if !strings.ContainsAny(v.String(), ".eE") {
			return v.String()
		}
		f, _ := v.Float64()
		return pyFloatRepr(f)
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

// JudgeTruthy is Python's truthiness of a decoded argument.
func JudgeTruthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case json.Number:
		f, _ := v.Float64()
		return f != 0
	case map[string]any:
		return len(v) > 0
	case []any:
		return len(v) > 0
	}
	return true
}
