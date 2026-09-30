package services

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The ragas loop: ragas 0.4.3's PydanticPrompt.generate_multiple through
// langevals' LangchainLLMWrapper. Reference: dev/docs/plans/langevals-go/
// ragas-0.4.3-reference.md §1-2.
const (
	ragasRepairs        = 3
	ragasAttempts       = 10
	ragasMaxBackoffSecs = 60
)

// ragasModel is one metric's judge model and the temperature langevals'
// client pins (0 means ragas picks its own).
type ragasModel struct {
	models      *Models
	model       string
	temperature float64
}

// newRagasModel is model_to_langchain: claude- names gain anthropic/, and a
// gpt-5 model always runs at temperature 1.
func newRagasModel(in EntryRun, model string, temperature float64) ragasModel {
	if strings.HasPrefix(model, "claude-") {
		model = "anthropic/" + model
	}
	if strings.Contains(model, "gpt-5") {
		temperature = 1
	}
	return ragasModel{models: in.Models, model: model, temperature: temperature}
}

// temperatureFor is the request's temperature: the client's when set, else
// ragas' get_temperature(n).
func (m ragasModel) temperatureFor(n int) float64 {
	switch {
	case m.temperature != 0:
		return m.temperature
	case n > 1:
		return 0.3
	default:
		return 0.01
	}
}

// ragasCall is one prompt asked with one input for n answers.
type ragasCall struct {
	prompt rules.RagasPrompt
	input  []rules.RagasField
	n      int
}

// ragasAnswer is one answer to a rendered prompt and the repairs it may use.
type ragasAnswer struct {
	prompt      rules.RagasPrompt
	rendered    string
	text        string
	repairsLeft int
}

// generate renders the prompt, asks for n answers and parses each one,
// repairing a malformed answer up to three times.
func (m ragasModel) generate(ctx context.Context, call ragasCall) ([]json.RawMessage, error) {
	return m.generateWithin(ctx, call, ragasRepairs)
}

// generateOne is PydanticPrompt.generate: one answer, decoded into out.
func (m ragasModel) generateOne(ctx context.Context, call ragasCall, out any) error {
	call.n = 1
	outputs, err := m.generate(ctx, call)
	if err != nil {
		return err
	}
	return json.Unmarshal(outputs[0], out)
}

func (m ragasModel) generateWithin(ctx context.Context, call ragasCall, repairsLeft int) ([]json.RawMessage, error) {
	rendered := call.prompt.Render(call.input)
	choices, err := m.complete(ctx, rendered, call.n)
	if err != nil {
		return nil, err
	}
	if len(choices) == 0 {
		return nil, &vendorFailure{errorType: "ValueError", details: "No generations returned by the LLM"}
	}
	outputs := make([]json.RawMessage, len(choices))
	for i, choice := range choices {
		answer := ragasAnswer{prompt: call.prompt, rendered: rendered, text: choice.Content, repairsLeft: repairsLeft}
		if outputs[i], err = m.parse(ctx, answer); err != nil {
			return nil, err
		}
	}
	return outputs, nil
}

// parse is RagasOutputParser.parse_output_string. The repaired text is
// parsed without extract_json, and its failure is not repaired again.
func (m ragasModel) parse(ctx context.Context, answer ragasAnswer) (json.RawMessage, error) {
	parsed, err := answer.prompt.Parse(rules.RagasExtractJSON(answer.text))
	if err == nil {
		return parsed, nil
	}
	if answer.repairsLeft == 0 {
		return nil, &vendorFailure{errorType: "RagasOutputParserException", details: "The output parser failed to parse the output including retries."}
	}
	fixed, err := m.generateWithin(ctx, ragasCall{prompt: rules.RagasFixOutputFormatPrompt(), n: 1, input: []rules.RagasField{
		{Name: "output_string", Value: answer.text},
		{Name: "prompt_value", Value: answer.rendered},
	}}, answer.repairsLeft-1)
	if err != nil {
		return nil, err
	}
	var repaired struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(fixed[0], &repaired); err != nil {
		return nil, err
	}
	if parsed, err = answer.prompt.Parse(repaired.Text); err != nil {
		return nil, &vendorFailure{errorType: "OutputParserException", details: err.Error()}
	}
	return parsed, nil
}

// complete makes one call of n answers, retrying rate limits only, and
// refuses an answer the model did not finish.
func (m ragasModel) complete(ctx context.Context, prompt string, n int) ([]channels.Choice, error) {
	temperature := m.temperatureFor(n)
	req := channels.CompletionRequest{
		Model:       m.model,
		Messages:    []channels.Message{{Role: "user", Content: prompt}},
		Temperature: &temperature,
		N:           n,
	}
	for attempt := 1; ; attempt++ {
		resp, err := m.models.Complete(ctx, req)
		if err == nil {
			return resp.Choices, ragasUnfinished(resp.Choices)
		}
		if !ragasRateLimited(err) || attempt == ragasAttempts {
			return nil, err
		}
		if err := ragasBackoff(ctx, attempt); err != nil {
			return nil, err
		}
	}
}

// ragasUnfinished is LangchainLLMWrapper.is_finished's refusal: any answer
// with a finish reason other than a stop, never retried.
func ragasUnfinished(choices []channels.Choice) error {
	for _, choice := range choices {
		if !ragasFinished(choice.FinishReason) {
			return &vendorFailure{errorType: "LLMDidNotFinishException", details: "The LLM generation was not completed. Please increase the max_tokens and try again."}
		}
	}
	return nil
}

// askPlain is a langchain invoke outside ragas: one call, no retry, no
// finish check, at the client's temperature.
func (m ragasModel) askPlain(ctx context.Context, prompt string) (string, error) {
	temperature := m.temperature
	resp, err := m.models.Complete(ctx, channels.CompletionRequest{
		Model:       m.model,
		Messages:    []channels.Message{{Role: "user", Content: prompt}},
		Temperature: &temperature,
	})
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "", errors.New("the model answered no choices")
	}
	return resp.Choices[0].Content, nil
}

// ragasFinished is LangchainLLMWrapper.is_finished; no reason is finished.
func ragasFinished(reason string) bool {
	return reason == "" || slices.Contains([]string{"stop", "STOP", "MAX_TOKENS", "eos_token", "end_turn"}, reason)
}

// ragasRateLimited reports a provider 429.
func ragasRateLimited(err error) bool {
	return errors.Is(err, channels.ErrRateLimited)
}

// ragasBackoff is tenacity's wait_random_exponential(multiplier=1, max=60).
func ragasBackoff(ctx context.Context, attempt int) error {
	ceiling := min(float64(ragasMaxBackoffSecs), float64(int(1)<<min(attempt-1, 6)))
	//nolint:gosec // retry jitter, as tenacity's random.uniform; not security-sensitive.
	timer := time.NewTimer(time.Duration(rand.Float64() * ceiling * float64(time.Second)))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
