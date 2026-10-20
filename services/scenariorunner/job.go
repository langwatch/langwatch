package scenariorunner

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// Job is what the runner reads off stdin: one agent-test turn, or a simulation.
type Job struct {
	AgentTest  *AgentTestTurnJob
	Simulation *SimulationJob
}

// ExecutionContext groups and correlates a run.
type ExecutionContext struct {
	ProjectID     string  `json:"projectId"`
	ScenarioID    string  `json:"scenarioId"`
	SetID         string  `json:"setId"`
	BatchRunID    string  `json:"batchRunId"`
	ScenarioRunID *string `json:"scenarioRunId,omitempty"`
}

// ScenarioDefinition is what is tested.
type ScenarioDefinition struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Situation string   `json:"situation"`
	Criteria  []string `json:"criteria"`
	Labels    []string `json:"labels"`
	MaxTurns  *int     `json:"maxTurns,omitempty"`
	MinTurns  *int     `json:"minTurns,omitempty"`
}

// TargetConfig names what the run tests against.
type TargetConfig struct {
	Type        string `json:"type"`
	ReferenceID string `json:"referenceId"`
}

// ScriptedRun is an agent test run's written-down conversation.
type ScriptedRun struct {
	Kind        string `json:"kind"`
	UserMessage string `json:"userMessage"`
}

// SimulationJob is a whole simulation (ChildProcessJobDataSchema).
type SimulationJob struct {
	Context              ExecutionContext          `json:"context"`
	Scenario             ScenarioDefinition        `json:"scenario"`
	Parameters           *jsjson.Object            `json:"-"`
	ScenarioRunID        *string                   `json:"scenarioRunId,omitempty"`
	AdapterData          targets.AdapterData       `json:"adapterData"`
	ModelParams          targets.LiteLLMParams     `json:"modelParams,omitempty"`
	SimulatorModelParams targets.LiteLLMParams     `json:"simulatorModelParams,omitempty"`
	JudgeModelParams     targets.LiteLLMParams     `json:"judgeModelParams,omitempty"`
	NLPServiceURL        string                    `json:"nlpServiceUrl"`
	ExecuteSyncRoute     *targets.ExecuteSyncRoute `json:"executeSyncRoute,omitempty"`
	Target               TargetConfig              `json:"target"`
	TraceWaitTimeoutMs   *float64                  `json:"traceWaitTimeoutMs,omitempty"`
	Script               *ScriptedRun              `json:"script,omitempty"`
}

// AgentTestTurnJob is one "test agent" turn (AgentTestTurnJobSchema).
type AgentTestTurnJob struct {
	Kind             string                   `json:"kind"`
	AdapterData      targets.AdapterData      `json:"adapterData"`
	ExecuteSyncRoute targets.ExecuteSyncRoute `json:"executeSyncRoute"`
	Parameters       *jsjson.Object           `json:"-"`
	Message          string                   `json:"message"`
	TimeoutMs        float64                  `json:"timeoutMs"`
	NLPTimeouts      targets.NLPTimeouts      `json:"nlpTimeouts"`
}

// fieldSpec is a key a level of the job must carry.
type fieldSpec struct {
	path string
	keys []string
}

var simulationRequired = []fieldSpec{
	{"", []string{"context", "scenario", "adapterData", "nlpServiceUrl", "target"}},
	{"context", []string{"projectId", "scenarioId", "setId", "batchRunId"}},
	{"scenario", []string{"id", "name", "situation", "criteria", "labels"}},
	{"target", []string{"type", "referenceId"}},
}

var agentTestRequired = []fieldSpec{
	{"", []string{"kind", "adapterData", "executeSyncRoute", "message", "timeoutMs", "nlpTimeouts"}},
}

// ParseJob decodes and validates a job, or returns the error the run fails with.
func ParseJob(data []byte) (Job, error) {
	job, err := parseJob(data)
	if err != nil {
		return Job{}, failure("Failed to parse job data: " + err.Error())
	}
	return job, nil
}

func parseJob(data []byte) (Job, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil {
		return Job{}, err
	}
	if kind, ok := top["kind"]; ok && string(kind) == `"agent-test-turn"` {
		j, err := parseAgentTest(data, top)
		return Job{AgentTest: j}, err
	}
	j, err := parseSimulation(data, top)
	return Job{Simulation: j}, err
}

func parseSimulation(data []byte, top map[string]json.RawMessage) (*SimulationJob, error) {
	if err := requireFields(top, simulationRequired); err != nil {
		return nil, err
	}
	var j SimulationJob
	if err := json.Unmarshal(data, &j); err != nil {
		return nil, validationError(err)
	}
	params, err := parseParameters(top["parameters"])
	if err != nil {
		return nil, err
	}
	j.Parameters = params
	if err := j.validate(); err != nil {
		return nil, err
	}
	return &j, nil
}

func (j *SimulationJob) validate() error {
	var issues []string
	if j.Script != nil && (j.Script.Kind != "agent_test" || j.Script.UserMessage == "") {
		issues = append(issues, "script: expected an agent_test script with a user message")
	}
	if j.Script == nil && j.SimulatorModelParams == nil && j.ModelParams == nil {
		issues = append(issues, "simulatorModelParams: No model params for the user simulator, and no modelParams to fall back to")
	}
	if j.Script == nil && j.JudgeModelParams == nil && j.ModelParams == nil {
		issues = append(issues, "judgeModelParams: No model params for the judge, and no modelParams to fall back to")
	}
	issues = append(issues, modelParamIssues(j)...)
	if len(issues) > 0 {
		return errors.New("Validation error: " + strings.Join(issues, "; "))
	}
	return nil
}

// modelParamIssues are role params that name no model.
func modelParamIssues(j *SimulationJob) []string {
	var issues []string
	roles := []struct {
		name   string
		params targets.LiteLLMParams
	}{{"modelParams", j.ModelParams}, {"simulatorModelParams", j.SimulatorModelParams}, {"judgeModelParams", j.JudgeModelParams}}
	for _, r := range roles {
		if r.params != nil && r.params.Model() == "" {
			issues = append(issues, r.name+".model: Required")
		}
	}
	return issues
}

func parseAgentTest(data []byte, top map[string]json.RawMessage) (*AgentTestTurnJob, error) {
	if err := requireFields(top, agentTestRequired); err != nil {
		return nil, err
	}
	var j AgentTestTurnJob
	if err := json.Unmarshal(data, &j); err != nil {
		return nil, validationError(err)
	}
	if j.TimeoutMs <= 0 || j.TimeoutMs != float64(int64(j.TimeoutMs)) {
		return nil, failure("Validation error: timeoutMs: expected a positive integer")
	}
	params, err := parseParameters(top["parameters"])
	if err != nil {
		return nil, err
	}
	j.Parameters = params
	return &j, nil
}

func validationError(err error) error {
	return errors.New("Validation error: " + strings.TrimPrefix(err.Error(), "json: "))
}

// requireFields checks each level of the job carries its required keys.
func requireFields(top map[string]json.RawMessage, specs []fieldSpec) error {
	var missing []string
	for _, spec := range specs {
		missing = append(missing, missingAt(top, spec)...)
	}
	if len(missing) > 0 {
		return errors.New("Validation error: " + strings.Join(missing, "; "))
	}
	return nil
}

// missingAt lists the required keys one level of the job lacks.
func missingAt(top map[string]json.RawMessage, spec fieldSpec) []string {
	level := top
	if spec.path != "" {
		if err := json.Unmarshal(top[spec.path], &level); err != nil {
			return []string{spec.path + ": expected an object"}
		}
	}
	var missing []string
	for _, k := range spec.keys {
		if v, ok := level[k]; !ok || string(v) == "null" {
			missing = append(missing, strings.TrimPrefix(spec.path+"."+k, ".")+": Required")
		}
	}
	return missing
}

// Run parameter limits (scenario.parameters.ts).
const (
	maxRunParameterKeys     = 50
	maxRunParameterBytes    = 16_384
	maxParameterValueLength = 4096
)

var parameterName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// parseParameters reads the run's resolved values, keeping their order.
func parseParameters(raw json.RawMessage) (*jsjson.Object, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return jsjson.NewObject(), nil
	}
	parsed, err := jsjson.Parse(raw)
	if err != nil {
		return nil, validationError(err)
	}
	obj, ok := parsed.(*jsjson.Object)
	if !ok {
		return nil, failure("Validation error: parameters: expected an object")
	}
	if err := validateParameters(obj); err != nil {
		return nil, errors.New("Validation error: parameters" + err.Error())
	}
	return obj, nil
}

func validateParameters(obj *jsjson.Object) error {
	if obj.Len() > maxRunParameterKeys {
		return fmt.Errorf(": A run can supply at most %d parameter values", maxRunParameterKeys)
	}
	if len(jsjson.Stringify(obj)) > maxRunParameterBytes {
		return fmt.Errorf(": Parameter values are limited to %d bytes in total", maxRunParameterBytes)
	}
	for _, k := range obj.Keys() {
		v, _ := obj.Get(k)
		if err := validateParameter(k, v); err != nil {
			return err
		}
	}
	return nil
}

func validateParameter(name string, value any) error {
	if !parameterName.MatchString(name) || name == "constructor" || name == "prototype" {
		return fmt.Errorf(".%s: invalid parameter name", name)
	}
	switch t := value.(type) {
	case bool, float64:
		return nil
	case string:
		if len([]rune(t)) > maxParameterValueLength {
			return fmt.Errorf(".%s: longer than %d characters", name, maxParameterValueLength)
		}
		return nil
	}
	return fmt.Errorf(".%s: expected a string, number or boolean", name)
}
