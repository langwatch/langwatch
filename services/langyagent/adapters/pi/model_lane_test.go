package pi

import (
	"encoding/json"
	"testing"
)

// @scenario OpenAI models use catalogue reasoning capabilities without losing unknown-model defaults
func TestModelLaneOpenAIReasoningComesFromCatalogue(t *testing.T) {
	for _, model := range []string{"openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-5-mini", "openai/custom-future-model"} {
		t.Run(model, func(t *testing.T) {
			lane := modelLane(model)
			encoded, err := json.Marshal(lane)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(encoded, &fields); err != nil {
				t.Fatal(err)
			}
			if _, ok := fields["reasoning"]; ok {
				t.Fatalf("provider default overrides model capability: %s", encoded)
			}
			if lane.API != "openai-responses" {
				t.Fatalf("API = %q", lane.API)
			}
		})
	}
}

func TestModelLaneOtherProviderReasoningDefaultsAreUnchanged(t *testing.T) {
	for _, model := range []string{"anthropic/claude-opus-5", "openai_codex/gpt-5"} {
		if !modelLane(model).Reasoning {
			t.Errorf("%s lost its reasoning default", model)
		}
	}
	if modelLane("custom/model").Reasoning {
		t.Error("custom completion model acquired reasoning")
	}
}
