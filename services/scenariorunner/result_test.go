package scenariorunner

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"

	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// The golden lines are what the Node child's JSON.stringify writes, and what
// the parent's parseResult and AgentTestTurnAnswerSchema read.
// @scenario "Every result line is byte-equal to the Node child's"
func TestResultLinesMatchTheNodeChild(t *testing.T) {
	label := "worker-2"
	cases := []struct {
		name string
		line string
		want string
	}{
		{"a passed run", SimulationResult{Success: true, Reasoning: "All criteria met"}.Line(),
			`{"success":true,"reasoning":"All criteria met"}`},
		{"a failed verdict is still a finished run", SimulationResult{Success: false}.Line(),
			`{"success":false}`},
		{"a connected run names its instance", SimulationResult{Success: true, AgentInstance: &targets.Instance{Hostname: "host-1", Label: &label}}.Line(),
			`{"success":true,"agentInstance":{"hostname":"host-1","label":"worker-2"}}`},
		{"an instance without a label", SimulationResult{Success: true, AgentInstance: &targets.Instance{Hostname: "host-1"}}.Line(),
			`{"success":true,"agentInstance":{"hostname":"host-1","label":null}}`},
		{"a voice run cut at the limit", SimulationResult{Success: true, IsCutAtLimit: true}.Line(),
			`{"success":true,"isCutAtLimit":true}`},
		{"a run that threw", FailureLine("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env"),
			`{"success":false,"error":"LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env"}`},
		{"an answered agent test turn", AgentTestAnswer{Success: true, Output: "hi there", DurationMs: 412}.Line(),
			`{"success":true,"output":"hi there","durationMs":412}`},
		{"an agent test turn past its deadline", AgentTestAnswer{Error: agentTestTimeoutMessage, TimeoutMs: 30000}.Line(),
			`{"success":false,"error":"The agent did not answer before the call deadline.","timeoutMs":30000}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.line)
		})
	}
}

// @scenario "A failure is flattened with its causes into one line"
func TestFormatErrorFlattensTheCauseChainLikeTheNodeChild(t *testing.T) {
	transport := &targets.Error{Name: "HttpAgentTransportError", Message: "HTTP agent target a.example could not be reached: Connection refused"}
	wrapped := &targets.Error{Name: "Error", Message: "[SerializedHttpAgentAdapter] HttpAgentTransportError: HTTP agent target a.example could not be reached: Connection refused", Cause: transport}
	assert.Equal(t,
		"[SerializedHttpAgentAdapter] HttpAgentTransportError: HTTP agent target a.example could not be reached: Connection refused: HTTP agent target a.example could not be reached: Connection refused",
		FormatError(wrapped))

	coded := &targets.Error{Message: "Connected agent call failed (agent_offline): no instance", Code: "agent_offline"}
	assert.Equal(t, "Connected agent call failed (agent_offline): no instance (agent_offline)", FormatError(coded))

	assert.Equal(t, "outer: inner", FormatError(fmt.Errorf("outer: %w", errors.New("inner"))))
}

// @scenario "The parent's resource attributes keep a scenario's labels together"
func TestParseResourceAttributesKeepsEscapedLabelsTogether(t *testing.T) {
	attrs := ParseResourceAttributes(`langwatch.origin.source=platform,scenario.labels=smoke,a\,b,c\=d`)
	assert.Equal(t, []attribute.KeyValue{
		attribute.String("langwatch.origin.source", "platform"),
		attribute.String("scenario.labels", "smoke,a,b,c=d"),
	}, attrs)
	assert.Empty(t, ParseResourceAttributes(""))
}
