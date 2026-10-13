package scenariorunner

import (
	"strings"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// SimulationResult is the last line a simulation writes. The parent's
// parseChildProcessResult reads success, reasoning, error, agentInstance and
// isCutAtLimit off it (scenario-child.supervisor.channel.ts).
type SimulationResult struct {
	Success       bool
	Reasoning     string
	AgentInstance *targets.Instance
	IsCutAtLimit  bool
}

// Line is the result as JSON.stringify writes it.
func (r SimulationResult) Line() string {
	obj := jsjson.NewObject().Set("success", r.Success)
	if r.Reasoning != "" {
		obj.Set("reasoning", r.Reasoning)
	}
	if r.AgentInstance != nil {
		obj.Set("agentInstance", instanceJSON(r.AgentInstance))
	}
	if r.IsCutAtLimit {
		obj.Set("isCutAtLimit", true)
	}
	return jsjson.Stringify(obj)
}

func instanceJSON(i *targets.Instance) *jsjson.Object {
	obj := jsjson.NewObject().Set("hostname", i.Hostname)
	if i.Label != nil {
		obj.Set("label", *i.Label)
	} else {
		obj.Set("label", nil)
	}
	return obj
}

// FailureLine is the line a run that threw writes before it exits 1.
func FailureLine(message string) string {
	return jsjson.Stringify(jsjson.NewObject().Set("success", false).Set("error", message))
}

// AgentTestAnswer is the last line of an agent-test turn (AgentTestTurnAnswerSchema).
type AgentTestAnswer struct {
	Success    bool
	Output     string
	DurationMs int64
	Error      string
	TimeoutMs  float64
}

// Line is the answer as JSON.stringify writes it.
func (a AgentTestAnswer) Line() string {
	if a.Success {
		return jsjson.Stringify(jsjson.NewObject().Set("success", true).Set("output", a.Output).Set("durationMs", float64(a.DurationMs)))
	}
	obj := jsjson.NewObject().Set("success", false).Set("error", a.Error)
	if a.TimeoutMs > 0 {
		obj.Set("timeoutMs", a.TimeoutMs)
	}
	return jsjson.Stringify(obj)
}

// maxCauseLinks bounds the walk of a cause chain that loops.
const maxCauseLinks = 32

// FormatError flattens an error and its causes into one line, as the Node
// child's formatScenarioChildError does: each message, with its code in
// parentheses when it has one, joined by ": ". A Go error that wraps with
// %w already prints its causes, so the walk stops there.
func FormatError(err error) string {
	var parts []string
	for cur, links := err, 0; cur != nil && links < maxCauseLinks; links++ {
		te, ok := cur.(*targets.Error)
		if !ok {
			parts = append(parts, cur.Error())
			break
		}
		msg := te.Message
		if te.Code != "" {
			msg += " (" + te.Code + ")"
		}
		parts = append(parts, msg)
		cur = te.Cause
	}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, ": ")
}

// failure is an error whose text reaches the parent as the Node child words
// it, capitals and all.
func failure(message string) error { return &targets.Error{Name: "Error", Message: message} }
