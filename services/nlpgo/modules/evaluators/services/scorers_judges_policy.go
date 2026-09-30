package services

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// judgeWireModel is the older judges' `vendor, model = model.split("/")`: the
// bare name for openai (unless kept), else the whole id.
func judgeWireModel(model string, keepPrefix func(name string) bool) (string, error) {
	parts := strings.Split(model, "/")
	switch {
	case len(parts) < 2:
		return "", &vendorFailure{errorType: "ValueError", details: "not enough values to unpack (expected 2, got 1)"}
	case len(parts) > 2:
		return "", &vendorFailure{errorType: "ValueError", details: "too many values to unpack (expected 2)"}
	}
	if parts[0] == "openai" && !keepPrefix(parts[1]) {
		return parts[1], nil
	}
	return model, nil
}

func neverKeepPrefix(string) bool { return false }

// judgeTrim is what the older judges trim: their messages, sent to model,
// limited by maxTokens and litellm.get_max_tokens of limitModel.
type judgeTrim struct {
	model      string
	limitModel string
	maxTokens  int
	messages   []rules.JudgeMessage
}

// trimmedJudgeMessages trims as the older judges do, to the smaller of the
// max tokens setting and the model's maximum.
func (j *judges) trimmedJudgeMessages(trim judgeTrim) ([]channels.Message, error) {
	if j.tokensErr != nil {
		return nil, j.tokensErr
	}
	messages := trim.messages
	if limit := rules.JudgeMaxOutputTokens(trim.limitModel); limit > 0 {
		if trim.maxTokens > 0 {
			limit = min(trim.maxTokens, limit)
		}
		messages = j.tokens.TrimJudgeMessages(trim.model, messages, limit)
	}
	out := make([]channels.Message, len(messages))
	for i, message := range messages {
		out[i] = channels.Message{Role: message.Role, Content: message.Content}
	}
	return out, nil
}

// competitorContent is input, then "\n" and output when there is one.
func competitorContent(entry contract.Entry) string {
	content := entryText(entry.Input)
	if output := entryText(entry.Output); output != "" {
		content += "\n" + output
	}
	return content
}

func competitorModels(model string) (wire, limit string, err error) {
	wire, err = judgeWireModel(model, func(name string) bool { return name == "gpt-4o" })
	limit = wire
	if wire == "openai/gpt-4o" {
		limit = "gpt-4-turbo"
	}
	return wire, limit, err
}

func (j *judges) scoreCompetitor(ctx context.Context, settings rules.CompetitorLLMSettings, in EntryRun) (contract.Result, error) {
	wire, limit, err := competitorModels(settings.Model)
	if err != nil {
		return vendorResult(err)
	}
	content := competitorContent(in.Entry)
	if content == "" {
		return skippedResult("Input and Output are empty"), nil
	}
	prompt := "You are a competitor detection system. Your task is to determine whether a question explicitly or implicitly refers to any competitors.\n        This includes: comparisons between our brand and others, direct inquiries about competitors' products or services, and any mention of similar industries.\n        Remember that Your company is " + settings.Name + " - " + settings.Description + ".\n        If a question pertains to a related industry but not directly to our company, treat it as an implicit reference to competitors."
	messages, err := j.trimmedJudgeMessages(judgeTrim{model: wire, limitModel: limit, maxTokens: settings.MaxTokens, messages: []rules.JudgeMessage{{Role: "system", Content: prompt}, {Role: "user", Content: content}}})
	if err != nil {
		return contract.Result{}, err
	}
	resp, err := completeJudge(ctx, in.Models, channels.CompletionRequest{
		Model:    wire,
		Messages: messages,
		Tools: []json.RawMessage{judgeToolSpec{name: "competitor_check", description: "Check if there is implicit mention of competitor", properties: map[string]any{
			"reasoning":            judgeProperty("string", "A short reasoning for the decision, written before the result"),
			"competitor_mentioned": judgeProperty("boolean", "True - If the competitor is mentioned, False - if not"),
			"confidence":           judgeProperty("number", "Confidence in your reasoning from 0 to 1"),
		}, required: []string{"competitor_mentioned", "confidence", "reasoning"}}.render()},
		ToolChoice: forcedJudgeToolChoice("competitor_check"),
	})
	if err != nil {
		return vendorResult(err)
	}
	arguments, err := judgeAnswer{tool: "competitor_check", required: []string{"competitor_mentioned"}, model: settings.Model}.read(resp)
	if err != nil {
		return vendorResult(err)
	}
	return competitorVerdict(arguments)
}

func (j *judges) scoreCompetitorFunctionCall(ctx context.Context, settings rules.CompetitorLLMFunctionCallSettings, in EntryRun) (contract.Result, error) {
	wire, limit, err := competitorModels(settings.Model)
	if err != nil {
		return vendorResult(err)
	}
	content := competitorContent(in.Entry)
	if content == "" {
		return skippedResult("Input and Output are empty"), nil
	}
	competitors := ""
	for _, competitor := range settings.Competitors {
		competitors += competitor + "\n"
	}
	prompt := "Remember that you are an advanced competitor detection system, developed by " + settings.Name + " - " + settings.Description + ".\n                    Your task is to identify mentions of competitors in any given message.\n                    The competitors specialize in the same field as your company and are listed below:\n\n                    Competitors:\n                    " + competitors + "\n\n                    Identify if the competitor was mentioned in the following message: " + content
	messages, err := j.trimmedJudgeMessages(judgeTrim{model: wire, limitModel: limit, maxTokens: settings.MaxTokens, messages: []rules.JudgeMessage{{Role: "user", Content: prompt}}})
	if err != nil {
		return contract.Result{}, err
	}
	resp, err := completeJudge(ctx, in.Models, channels.CompletionRequest{
		Model:    wire,
		Messages: messages,
		Tools: []json.RawMessage{judgeToolSpec{name: "competitor_check", description: "Check if any competitor was mentioned", properties: map[string]any{
			"reasoning":            judgeProperty("string", "Explain why you think the competitor was or was not mentioned."),
			"confidence":           judgeProperty("number", "Confidence that the competitor was mentioned on the scale from 0 to 1."),
			"competitor_mentioned": judgeProperty("boolean", "True - If the competitor is mentioned, False - if not."),
		}, required: []string{"confidence", "reasoning", "competitor_mentioned"}}.render()},
	})
	if err != nil {
		return vendorResult(err)
	}
	calls := judgeToolCalls(resp)
	if len(calls) == 0 {
		return errorResult("IndexError", "list index out of range"), nil
	}
	arguments, problem := rules.ReadJudgeArguments(calls[0].Arguments, nil)
	if problem != "" {
		return errorResult("JSONDecodeError", "the evaluator model's function arguments are not a JSON object"), nil
	}
	return competitorVerdict(arguments)
}

// competitorVerdict reads the arguments as both competitor judges do: passed
// unless a competitor was mentioned, and details only when one was.
func competitorVerdict(arguments map[string]any) (contract.Result, error) {
	passed := true
	if mentioned, ok := arguments["competitor_mentioned"]; ok {
		passed = !rules.JudgeTruthy(mentioned)
	}
	confidence, ok := arguments["confidence"]
	if !ok {
		confidence = json.Number("1")
	}
	reasoning, ok := arguments["reasoning"]
	if !ok {
		reasoning = "No reasoning."
	}
	score, ok := rules.JudgeFloat(confidence)
	if !ok {
		return errorResult("TypeError", "confidence is not a number"), nil
	}
	details := ""
	if !passed {
		details = rules.JudgeText(confidence) + " - confidence score. Reasoning: " + rules.JudgeText(reasoning)
	}
	return vendorVerdict(score, passed, details), nil
}

func (j *judges) scoreOffTopic(ctx context.Context, settings rules.OffTopicSettings, in EntryRun) (contract.Result, error) {
	wire, err := judgeWireModel(settings.Model, neverKeepPrefix)
	if err != nil {
		return vendorResult(err)
	}
	content := entryText(in.Entry.Input)
	if content == "" {
		return skippedResult("Input is empty"), nil
	}
	descriptions, intents := offTopicIntents(settings.AllowedTopics)
	prompt := "You are an intent classification system. Your goal is to identify the intent of the message. Consider these intents and their following descriptions: " + strings.Join(descriptions, "\n #")
	messages, err := j.trimmedJudgeMessages(judgeTrim{model: wire, limitModel: wire, maxTokens: settings.MaxTokens, messages: []rules.JudgeMessage{{Role: "system", Content: prompt}, {Role: "user", Content: content}}})
	if err != nil {
		return contract.Result{}, err
	}
	intent := judgeProperty("string", "The intent of the user message, what is the message about")
	intent["enum"] = append(intents, "other")
	resp, err := completeJudge(ctx, in.Models, channels.CompletionRequest{
		Model:    wire,
		Messages: messages,
		Tools: []json.RawMessage{judgeToolSpec{name: "identify_intent", description: "Identify the intent of the message", properties: map[string]any{
			"intent":     intent,
			"confidence": judgeProperty("number", "Confidence in the identified intent on the scale from 0.0 to 1.0"),
		}, required: []string{"intent", "confidence"}}.render()},
		ToolChoice: forcedJudgeToolChoice("identify_intent"),
	})
	if err != nil {
		return vendorResult(err)
	}
	arguments, err := judgeAnswer{tool: "identify_intent", required: []string{"intent", "confidence"}, model: settings.Model}.read(resp)
	if err != nil {
		return vendorResult(err)
	}
	detected := rules.JudgeText(arguments["intent"])
	score, ok := rules.JudgeFloat(arguments["confidence"])
	if !ok {
		return errorResult("TypeError", "confidence is not a number"), nil
	}
	result := vendorVerdict(score, detected != "other", "Detected intent: "+detected)
	result.Label = &detected
	return result, nil
}

// offTopicIntents are the prompt's topic lines and the intent enum, each
// topic once in settings order (Python's set order is not reproducible).
func offTopicIntents(topics []rules.AllowedTopic) (descriptions, intents []string) {
	seen := map[string]bool{}
	for _, topic := range topics {
		descriptions = append(descriptions, "Intent: "+topic.Topic+" - Description: "+topic.Description)
		if !seen[topic.Topic] {
			seen[topic.Topic] = true
			intents = append(intents, topic.Topic)
		}
	}
	return descriptions, intents
}

type conversationTurn struct {
	Input  string `json:"input"`
	Output string `json:"output"`
}

// conversationText is the "USER: ... ASSISTANT: ..." transcript, "" when no
// turn has an input (Python's skip).
func conversationText(raw json.RawMessage) (string, bool) {
	var turns []conversationTurn
	if json.Unmarshal(raw, &turns) != nil {
		return "", false
	}
	var conversation strings.Builder
	asked := false
	for _, turn := range turns {
		asked = asked || turn.Input != ""
		conversation.WriteString("USER: " + turn.Input + "\n ASSISTANT: " + turn.Output + "\n")
	}
	if !asked {
		return "", true
	}
	return conversation.String(), true
}

func (j *judges) scoreQueryResolution(ctx context.Context, settings rules.LLMEvaluatorSettings, in EntryRun) (contract.Result, error) {
	wire, err := judgeWireModel(settings.Model, neverKeepPrefix)
	if err != nil {
		return vendorResult(err)
	}
	conversation, ok := conversationText(in.Entry.Conversation)
	if !ok {
		return errorResult("ValidationError", "conversation must be a list of input and output turns"), nil
	}
	if conversation == "" {
		return skippedResult("The conversation is empty"), nil
	}
	prompt := "You are an accurate Query Resolution Evaluator. Your goal is to find out if all of the user querries were resolved in the conversation with the chatbot."
	messages, err := j.trimmedJudgeMessages(judgeTrim{model: wire, limitModel: wire, maxTokens: settings.MaxTokens, messages: []rules.JudgeMessage{{Role: "system", Content: prompt}, {Role: "user", Content: conversation}}})
	if err != nil {
		return contract.Result{}, err
	}
	resp, err := completeJudge(ctx, in.Models, channels.CompletionRequest{
		Model:    wire,
		Messages: messages,
		Tools: []json.RawMessage{judgeToolSpec{name: "query_resolution_evaluator", description: "Evaluate if all of the queries were answered", properties: map[string]any{
			"reasoning":        judgeProperty("string", "Reasoning for the answer"),
			"queries_total":    judgeProperty("number", "Number of total user queries in the dialogue, greetings and non-requests do not count"), //nolint:misspell // langevals prompt text
			"queries_answered": judgeProperty("number", "Number of resolved user queries in the dialogue"),                                       //nolint:misspell // langevals prompt text
		}, required: []string{"reasoning", "queries_total", "queries_answered"}}.render()},
		ToolChoice: forcedJudgeToolChoice("query_resolution_evaluator"),
	})
	if err != nil {
		return vendorResult(err)
	}
	required := []string{"reasoning", "queries_total", "queries_answered"}
	arguments, err := judgeAnswer{tool: "query_resolution_evaluator", required: required, model: settings.Model}.read(resp)
	if err != nil {
		return vendorResult(err)
	}
	total, totalOK := rules.JudgeFloat(arguments["queries_total"])
	answered, answeredOK := rules.JudgeFloat(arguments["queries_answered"])
	if !totalOK || !answeredOK {
		return errorResult("TypeError", "queries_total and queries_answered must be numbers"), nil
	}
	ratio := 1.0
	if answered != 0 || total != 0 {
		ratio = answered / max(total, 1)
	}
	details := "There were " + rules.JudgeText(arguments["queries_total"]) + " queries in total and " + rules.JudgeText(arguments["queries_answered"]) + " of them were resolved in the conversation. Reasoning: " + rules.JudgeText(arguments["reasoning"])
	return vendorVerdict(ratio, answered == total, details), nil
}
