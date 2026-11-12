package scenario

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Scenarios of specs/judge-derived-answers.feature in the scenario
// repository: a finish_test call that leaves a criterion without a readable
// answer is re-asked once, and a stringified criteria object is read.

var reaskCriteria = []string{"The agent greets the user", "The agent quotes the right price"}

// finishWith builds finish_test arguments answering the named criteria
// (by index) as passed; stringify sends criteria as a JSON string.
func finishWith(stringify bool, answered ...int) string {
	names := criteriaParamNames(reaskCriteria)
	answers := map[string]any{}
	for _, i := range answered {
		answers[names[i]] = map[string]any{"requirement": "req", "reasoning": "why", "status": "passed"}
	}
	var criteria any = answers
	if stringify {
		b, _ := json.Marshal(answers)
		criteria = string(b)
	}
	b, _ := json.Marshal(map[string]any{"criteria": criteria, "reasoning": "summary"})
	return string(b)
}

func judgeVerdict(t *testing.T, llm LLM) JudgeResult {
	t.Helper()
	j := NewJudgeAgent(JudgeAgentConfig{ModelConfig: ModelConfig{LLM: llm, Model: "judge-model"}, Criteria: reaskCriteria, SpanCollector: NewSpanCollector()})
	ret, err := j.Call(context.Background(), AgentInput{
		ThreadID:        "thread-reask",
		Messages:        []Message{{Role: RoleUser, Content: "hi"}, {Role: RoleAssistant, Content: "hello, it costs 10"}},
		JudgmentRequest: &JudgmentRequest{},
		ScenarioConfig:  ScenarioConfig{Name: "reask", Description: "the agent greets and quotes"},
	})
	if err != nil {
		t.Fatal(err)
	}
	v, ok := ret.Verdict()
	if !ok {
		t.Fatalf("no verdict: %+v", ret)
	}
	return *v
}

func TestJudgeReasksMissingCriterion(t *testing.T) {
	llm := &scriptedLLM{answer: func(n int, _ InferenceParams) *InferenceResult {
		if n == 1 {
			return toolCallAnswer("finish_test", finishWith(false, 0))
		}
		return toolCallAnswer("finish_test", finishWith(false, 1))
	}}
	res := judgeVerdict(t, llm)
	calls := llm.calls()
	if len(calls) != 2 {
		t.Fatalf("calls %d", len(calls))
	}
	if !res.Success || len(res.MetCriteria) != 2 {
		t.Errorf("verdict %+v", res)
	}
	retry := calls[1]
	last := retry.Messages[len(retry.Messages)-1].Content
	want := "Your finish_test call did not give a usable verdict for the criteria below. Call finish_test again with a requirement, a reasoning and a status for every criterion. Pass criteria as an object keyed by criterion, not as a string.\n1. " + reaskCriteria[1]
	if last != want {
		t.Errorf("re-ask prompt %q", last)
	}
	prev := retry.Messages[len(retry.Messages)-2]
	if prev.Role != RoleAssistant || !strings.HasPrefix(prev.Content, "My finish_test call: {") {
		t.Errorf("assistant recap %+v", prev)
	}
	if c := retry.ToolChoice; c == nil || c.Type != ToolChoiceTool || c.ToolName != "finish_test" {
		t.Errorf("tool choice %+v", c)
	}
	if len(retry.Tools) != 1 || retry.Tools[0].Name != "finish_test" {
		t.Errorf("tools %v", retry.Tools)
	}
}

func TestJudgeReadsStringifiedCriteria(t *testing.T) {
	llm := &scriptedLLM{answer: func(int, InferenceParams) *InferenceResult {
		return toolCallAnswer("finish_test", finishWith(true, 0, 1))
	}}
	res := judgeVerdict(t, llm)
	if n := len(llm.calls()); n != 1 {
		t.Errorf("calls %d", n)
	}
	if !res.Success {
		t.Errorf("verdict %+v", res)
	}
}

func TestJudgeStillMissingAfterReaskFailsClosed(t *testing.T) {
	llm := &scriptedLLM{answer: func(int, InferenceParams) *InferenceResult {
		return toolCallAnswer("finish_test", finishWith(false, 0))
	}}
	res := judgeVerdict(t, llm)
	if n := len(llm.calls()); n != 2 {
		t.Errorf("calls %d", n)
	}
	if res.Success || len(res.UnmetCriteria) != 1 || res.UnmetCriteria[0] != reaskCriteria[1] {
		t.Errorf("verdict %+v", res)
	}
}
