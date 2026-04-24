package providers

import (
	"fmt"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/bytedance/sonic"
)

// parseOpenAIChatRequest decodes an OpenAI-shape /v1/chat/completions body
// into Bifrost's normalized request structures. Bifrost's own ChatMessage +
// ChatParameters types carry OpenAI-compatible JSON tags, so each provider
// family translates from this neutral shape downstream (OpenAI → pass-through,
// Anthropic → Messages API, Gemini → generateContent, etc.).
//
// The input []ChatMessage is read off the `messages` key; everything else
// (temperature, tools, response_format, stream_options, seed, logprobs,
// max_completion_tokens, ...) unmarshals onto ChatParameters via its json
// tags. `stream` is not part of ChatParameters — the caller decides the
// streaming dispatch path, so we simply discard it here.
func parseOpenAIChatRequest(body []byte) ([]bfschemas.ChatMessage, *bfschemas.ChatParameters, error) {
	if len(body) == 0 {
		return nil, nil, nil
	}

	var messagesWrap struct {
		Messages []bfschemas.ChatMessage `json:"messages"`
	}
	if err := sonic.Unmarshal(body, &messagesWrap); err != nil {
		return nil, nil, fmt.Errorf("parse messages: %w", err)
	}

	var params bfschemas.ChatParameters
	if err := sonic.Unmarshal(body, &params); err != nil {
		return nil, nil, fmt.Errorf("parse params: %w", err)
	}

	return messagesWrap.Messages, &params, nil
}
