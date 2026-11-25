package cmd

import (
	"strings"
	"testing"
)

const llmTwoModels = `{"calls":[
{"id":"2","path":"/v1/chat/completions","dialect":"openai","model":"gpt-5-mini","mode":"markov","status":200},
{"id":"1","path":"/v1/messages","dialect":"anthropic","model":"claude-error-429","mode":"markov","status":429,"error":"rate limited"}]}`

// @scenario "haven sim llm list filters by model and failure"
func TestLLMCallsFiltersByModelAndFailure(t *testing.T) {
	api, _ := stubSim(t, map[string]string{
		"GET /_sim/api/calls": llmTwoModels,
		"GET /_sim/api/info":  `{"stack":"s","models":["markov-small"],"capacity":500,"settings":{"forcedError":0,"seed":""}}`,
	})
	run := func(asJSON bool, flags map[string]string) string {
		inv := simInv("calls")
		inv.flags = flags
		return captureStdout(t, func() {
			if err := llmCommand(api, inv, asJSON); err != nil {
				t.Fatal(err)
			}
		})
	}

	byModel := run(false, map[string]string{"--model": "gpt"})
	if !strings.Contains(byModel, "gpt-5-mini") || strings.Contains(byModel, "claude") || !strings.Contains(byModel, "openai") {
		t.Fatalf("--model gpt listed %q, want only the gpt call with its dialect", byModel)
	}
	failed := run(true, map[string]string{"--failed": ""})
	if !strings.Contains(failed, `"claude-error-429"`) || strings.Contains(failed, "gpt-5-mini") {
		t.Fatalf("--failed --json listed %q, want only the 429 call", failed)
	}

	info := captureStdout(t, func() {
		if err := llmCommand(api, simInv("info"), false); err != nil {
			t.Fatal(err)
		}
	})
	if !strings.Contains(info, "calls kept: 500") {
		t.Fatalf("info printed %q, want the capacity", info)
	}
}
