package services

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// judgeResultFraming is llm_boolean's RESULT_FRAMING, verbatim.
const judgeResultFraming = "Answer by calling the `evaluation` function, setting `result` to exactly the true or false value the instructions above ask you to return. If they say when to return false, return false in that case and true in every other case. If they say when to return true, return true in that case and false in every other case. `result` is not a rating of the output, never invert it."

// judges holds what every langevals judge shares: the token counter.
type judges struct {
	tokens    *rules.TokenCounter
	tokensErr error
}

// judgePrepares are the langevals LLM-as-judge evaluators (plan §8.4);
// select_best_compare waits on candidates reaching contract.Entry.
func judgePrepares() map[string]func(json.RawMessage) (Score, error) {
	counter, err := rules.NewTokenCounter()
	j := &judges{tokens: counter, tokensErr: err}
	return map[string]func(json.RawMessage) (Score, error){
		"langevals/llm_boolean":                  WithSettings(rules.ParseCustomLLMBooleanSettings, j.scoreBoolean),
		"langevals/llm_score":                    WithSettings(rules.ParseCustomLLMScoreSettings, j.scoreNumeric),
		"langevals/llm_category":                 WithSettings(rules.ParseCustomLLMCategorySettings, j.scoreCategory),
		"langevals/llm_answer_match":             WithSettings(rules.ParseLLMAnswerMatchSettings, j.scoreAnswerMatch),
		"langevals/competitor_llm":               WithSettings(rules.ParseCompetitorLLMSettings, j.scoreCompetitor),
		"langevals/competitor_llm_function_call": WithSettings(rules.ParseCompetitorLLMFunctionCallSettings, j.scoreCompetitorFunctionCall),
		"langevals/off_topic":                    WithSettings(rules.ParseOffTopicSettings, j.scoreOffTopic),
		"langevals/query_resolution":             WithSettings(rules.ParseLLMEvaluatorSettings, j.scoreQueryResolution),
	}
}

// judgeEntryFields reads input, output and contexts; contexts must be strings.
func judgeEntryFields(entry contract.Entry) (rules.JudgeFields, error) {
	contexts, ok := stringList(entry.Contexts)
	if !ok {
		return rules.JudgeFields{}, &vendorFailure{errorType: "ValidationError", details: "contexts must be a list of strings"}
	}
	return rules.JudgeFields{Input: entry.Input, Output: entry.Output, Contexts: contexts}, nil
}

func judgeHasContent(fields rules.JudgeFields) bool {
	return entryText(fields.Input) != "" || entryText(fields.Output) != "" || len(fields.Contexts) > 0
}

// promptJudge is the shape llm_boolean, llm_score and llm_category share: fit
// the content, one forced call to `evaluation`, its arguments read.
type promptJudge struct {
	settings rules.LLMEvaluatorSettings
	system   string
	task     string
	reserved []string
	tool     json.RawMessage
	required []string
}

func (j *judges) runPromptJudge(ctx context.Context, judge promptJudge, in EntryRun) (map[string]any, rules.JudgeFit, *contract.Result, error) {
	fields, err := judgeEntryFields(in.Entry)
	if err != nil {
		return nil, rules.JudgeFit{}, nil, err
	}
	if !judgeHasContent(fields) {
		skipped := skippedResult("No content to evaluate")
		return nil, rules.JudgeFit{}, &skipped, nil
	}
	if j.tokensErr != nil {
		return nil, rules.JudgeFit{}, nil, j.tokensErr
	}
	fit := j.tokens.FitJudgeContent(rules.JudgeFitRequest{Model: judge.settings.Model, MaxTokens: judge.settings.MaxTokens, Reserved: judge.reserved, Fields: fields})
	if fit.Skip != "" {
		skipped := skippedResult(fit.Skip)
		return nil, fit, &skipped, nil
	}
	resp, err := completeJudge(ctx, in.Models, channels.CompletionRequest{
		Model: judge.settings.Model,
		Messages: []channels.Message{
			{Role: "system", Content: judge.system},
			{Role: "user", Content: rules.JudgeUserContent(fit.Fields, judge.task)},
		},
		Tools:      []json.RawMessage{judge.tool},
		ToolChoice: forcedJudgeToolChoice("evaluation"),
	})
	if err != nil {
		return nil, fit, nil, err
	}
	arguments, err := judgeAnswer{tool: "evaluation", required: judge.required, model: judge.settings.Model}.read(resp)
	return arguments, fit, nil, err
}

func (j *judges) scoreBoolean(ctx context.Context, settings rules.LLMPromptSettings, in EntryRun) (contract.Result, error) {
	system := settings.Prompt + "\n\n" + judgeResultFraming
	arguments, fit, skipped, err := j.runPromptJudge(ctx, promptJudge{
		settings: settings.LLMEvaluatorSettings,
		system:   system,
		task:     settings.Prompt,
		reserved: []string{system, settings.Prompt},
		tool: judgeToolSpec{name: "evaluation", description: "Record the true or false value the instructions ask for. Write a short reasoning first, then the result.", properties: map[string]any{
			"reasoning": judgeProperty("string", "A short reasoning, written before the result: name the condition the instructions give and the value they ask for when it holds, say whether it holds for this content, then state the value that follows."),
			"result":    judgeProperty("boolean", "Exactly the value the instructions ask you to return. If they say when to return false: false in that case, true otherwise. If they say when to return true: true in that case, false otherwise. Not a judgment of whether the content is good."),
		}, required: []string{"reasoning", "result"}}.render(),
		required: []string{"reasoning", "result"},
	}, in)
	if skipped != nil || err != nil {
		return judgeOutcome(skipped, err)
	}
	passed, ok := rules.JudgeBoolean(arguments["result"])
	if !ok {
		return vendorResult(&vendorFailure{errorType: "JudgeAnswerError", details: rules.JudgeAnswerMessage("evaluation", "sent a result that is neither true nor false", settings.Model)})
	}
	return vendorVerdict(boolScore(passed), passed, fit.WithNote(rules.JudgeText(arguments["reasoning"]))), nil
}

func (j *judges) scoreNumeric(ctx context.Context, settings rules.LLMPromptSettings, in EntryRun) (contract.Result, error) {
	system := settings.Prompt + ". Always output a valid json for the function call"
	arguments, fit, skipped, err := j.runPromptJudge(ctx, promptJudge{
		settings: settings.LLMEvaluatorSettings,
		system:   system,
		task:     settings.Prompt,
		reserved: []string{system, settings.Prompt},
		tool: judgeToolSpec{name: "evaluation", description: "Record the evaluation: a short reasoning first, then the final score.", properties: map[string]any{
			"reasoning":   judgeProperty("string", "use this field to break down the task and explain your reasoning in multiple sub-scores, using it to combine into a final score"),
			"final_score": judgeProperty("number", "your final score for the task"),
		}, required: []string{"reasoning", "final_score"}}.render(),
		required: []string{"reasoning", "final_score"},
	}, in)
	if skipped != nil || err != nil {
		return judgeOutcome(skipped, err)
	}
	score, ok := rules.JudgeFloat(arguments["final_score"])
	if !ok {
		return vendorResult(&vendorFailure{errorType: "ValidationError", details: "final_score is not a number"})
	}
	details := fit.WithNote(rules.JudgeText(arguments["reasoning"]))
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Details: &details}, nil
}

func (j *judges) scoreCategory(ctx context.Context, settings rules.CustomLLMCategorySettings, in EntryRun) (contract.Result, error) {
	lines := make([]string, len(settings.Categories))
	names := make([]string, len(settings.Categories))
	for i, category := range settings.Categories {
		lines[i] = "- " + category.Name + ": " + category.Description
		names[i] = category.Name
	}
	task := settings.Prompt + "\n\n# Categories\n" + strings.Join(lines, "\n")
	system := settings.Prompt + ". Always output a valid json for the function call"
	label := judgeProperty("string", "the final decision of the category for the message")
	label["enum"] = names
	arguments, fit, skipped, err := j.runPromptJudge(ctx, promptJudge{
		settings: settings.LLMEvaluatorSettings,
		system:   system,
		task:     task,
		reserved: []string{system, task},
		tool: judgeToolSpec{name: "evaluation", description: "Record the category of the message: a short reasoning first, then the label.", properties: map[string]any{
			"reasoning": judgeProperty("string", "a short reasoning for the decision, written before the label"),
			"label":     label,
		}, required: []string{"reasoning", "label"}}.render(),
		required: []string{"reasoning", "label"},
	}, in)
	if skipped != nil || err != nil {
		return judgeOutcome(skipped, err)
	}
	chosen, ok := arguments["label"].(string)
	if !ok {
		return vendorResult(&vendorFailure{errorType: "ValidationError", details: "label is not a string"})
	}
	details := fit.WithNote(rules.JudgeText(arguments["reasoning"]))
	return contract.Result{Status: contract.StatusProcessed, Label: &chosen, Details: &details}, nil
}

// judgeOutcome answers a skip, or a judge failure as its entry error.
func judgeOutcome(skipped *contract.Result, err error) (contract.Result, error) {
	if skipped != nil {
		return *skipped, nil
	}
	return vendorResult(err)
}

func (j *judges) scoreAnswerMatch(ctx context.Context, settings rules.LLMAnswerMatchSettings, in EntryRun) (contract.Result, error) {
	if j.tokensErr != nil {
		return contract.Result{}, j.tokensErr
	}
	question := entryText(in.Entry.Input)
	fit := j.tokens.FitJudgeContent(rules.JudgeFitRequest{
		Model:     settings.Model,
		MaxTokens: settings.MaxTokens,
		Reserved:  []string{settings.Prompt, rules.AnswerMatchSignatureText},
		Fields:    rules.JudgeFields{Input: &question, Output: in.Entry.Output, ExpectedOutput: in.Entry.ExpectedOutput},
	})
	if fit.Skip != "" {
		return skippedResult(fit.Skip), nil
	}
	system, user := rules.AnswerMatchMessages(rules.AnswerMatchInputs{
		Instructions: settings.Prompt,
		Question:     entryText(fit.Fields.Input),
		Gold:         entryText(fit.Fields.ExpectedOutput),
		Predicted:    entryText(fit.Fields.Output),
	})
	temperature := 0.0
	if strings.Contains(settings.Model, "gpt-5") {
		temperature = 1.0
	}
	resp, err := in.Models.Complete(ctx, channels.CompletionRequest{
		Model:       settings.Model,
		Messages:    []channels.Message{{Role: "system", Content: system}, {Role: "user", Content: user}},
		Temperature: &temperature,
	})
	if err != nil {
		return contract.Result{}, err
	}
	completion := ""
	if len(resp.Choices) > 0 {
		completion = resp.Choices[0].Content
	}
	reasoning, isCorrect, ok := rules.ParseAnswerMatch(completion)
	if !ok {
		return errorResult("AdapterParseError", "the evaluator model's answer did not carry the reasoning and is_correct fields"), nil
	}
	passed := strings.Contains(strings.ToLower(isCorrect), "true")
	return vendorVerdict(boolScore(passed), passed, fit.WithNote(reasoning)), nil
}
