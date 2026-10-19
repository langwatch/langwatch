package scenariorunner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const simulationJobJSON = `{
  "context": {"projectId": "project_1", "scenarioId": "scen_1", "setId": "set_1", "batchRunId": "batch_1"},
  "scenario": {"id": "scen_1", "name": "Greets", "situation": "A user says hi", "criteria": ["says hello"], "labels": ["smoke", "a,b"], "maxTurns": 3},
  "parameters": {"tier": "gold", "seats": 3, "trial": true},
  "scenarioRunId": "scenariorun_1",
  "adapterData": {"type": "http", "agentId": "agent_1", "url": "https://agent.example/chat", "method": "POST", "headers": [],
    "scenarioMappings": {"question": {"type": "source", "sourceId": "scenario", "path": ["input"]}, "fixed": {"type": "value", "value": "v"}}},
  "simulatorModelParams": {"model": "openai/gpt-5-mini", "api_key": "sk-sim"},
  "judgeModelParams": {"model": "openai/gpt-5", "api_key": "sk-judge"},
  "nlpServiceUrl": "http://nlp:5561",
  "executeSyncRoute": {"mode": "relay", "relayBaseUrl": "https://app.example"},
  "target": {"type": "http", "referenceId": "agent_1"},
  "traceWaitTimeoutMs": 12000
}`

// @scenario "A simulation job is read with its mappings and parameters in order"
func TestParseJobReadsASimulation(t *testing.T) {
	job, err := ParseJob([]byte(simulationJobJSON))
	require.NoError(t, err)
	require.NotNil(t, job.Simulation)
	require.Nil(t, job.AgentTest)
	sim := job.Simulation
	assert.Equal(t, "batch_1", sim.Context.BatchRunID)
	assert.Equal(t, "A user says hi", sim.Scenario.Situation)
	assert.Equal(t, 3, *sim.Scenario.MaxTurns)
	assert.Equal(t, "http", sim.AdapterData.Type)
	assert.Equal(t, []string{"question", "fixed"}, sim.AdapterData.HTTP.ScenarioMappings.Keys, "mappings keep the job's order")
	assert.Equal(t, []string{"tier", "seats", "trial"}, sim.Parameters.Keys(), "parameters keep the job's order")
	assert.Equal(t, "openai/gpt-5", sim.JudgeModelParams.Model())
	assert.Equal(t, "relay", sim.ExecuteSyncRoute.Mode)
}

// @scenario "An agent-test turn job is read"
func TestParseJobReadsAnAgentTestTurn(t *testing.T) {
	job, err := ParseJob([]byte(`{"kind":"agent-test-turn","adapterData":{"type":"connected","agentId":"a","endpoint":"https://app.example","timeoutMs":5000},
		"executeSyncRoute":{"mode":"direct","nlpServiceUrl":"http://nlp"},"message":"hi","timeoutMs":30000,"nlpTimeouts":{}}`))
	require.NoError(t, err)
	require.NotNil(t, job.AgentTest)
	assert.Equal(t, "hi", job.AgentTest.Message)
	assert.Equal(t, 5000, job.AgentTest.AdapterData.Connected.TimeoutMs)
	assert.Equal(t, 0, job.AgentTest.Parameters.Len(), "absent parameters read as none")
}

// @scenario "A job the runner cannot read fails with the Node child's prefix"
func TestParseJobRefusals(t *testing.T) {
	cases := []struct {
		name string
		job  string
		want string
	}{
		{"not JSON", `{"context":`, "Failed to parse job data: "},
		{"missing required fields", `{"context":{"projectId":"p"},"scenario":{},"adapterData":{"type":"http"},"nlpServiceUrl":"x","target":{}}`,
			"context.scenarioId: Required"},
		{"no model for the simulator or judge", `{"context":{"projectId":"p","scenarioId":"s","setId":"x","batchRunId":"b"},
			"scenario":{"id":"s","name":"n","situation":"x","criteria":[],"labels":[]},
			"adapterData":{"type":"connected","agentId":"a","endpoint":"e","timeoutMs":1},"nlpServiceUrl":"x","target":{"type":"connected","referenceId":"a"}}`,
			"No model params for the user simulator, and no modelParams to fall back to"},
		{"unknown target type", `{"context":{"projectId":"p","scenarioId":"s","setId":"x","batchRunId":"b"},
			"scenario":{"id":"s","name":"n","situation":"x","criteria":[],"labels":[]},"modelParams":{"model":"m"},
			"adapterData":{"type":"fax"},"nlpServiceUrl":"x","target":{"type":"http","referenceId":"a"}}`,
			`unknown target type "fax"`},
		{"agent test turn without a deadline", `{"kind":"agent-test-turn","adapterData":{"type":"http"},"executeSyncRoute":{"mode":"direct"},"message":"m","nlpTimeouts":{}}`,
			"timeoutMs: Required"},
		{"a reserved parameter name", `{"kind":"agent-test-turn","adapterData":{"type":"connected","agentId":"a","endpoint":"e","timeoutMs":1},
			"executeSyncRoute":{"mode":"direct"},"message":"m","timeoutMs":5,"nlpTimeouts":{},"parameters":{"constructor":"x"}}`,
			"parameters.constructor"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseJob([]byte(tc.job))
			require.ErrorContains(t, err, "Failed to parse job data: ")
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestParseJobAcceptsAScriptedRunWithoutModels(t *testing.T) {
	job, err := ParseJob([]byte(`{"context":{"projectId":"p","scenarioId":"s","setId":"x","batchRunId":"b"},
		"scenario":{"id":"s","name":"n","situation":"x","criteria":[],"labels":[]},
		"adapterData":{"type":"connected","agentId":"a","endpoint":"e","timeoutMs":1},"nlpServiceUrl":"x",
		"target":{"type":"connected","referenceId":"a"},"script":{"kind":"agent_test","userMessage":"hello"}}`))
	require.NoError(t, err)
	assert.Equal(t, "hello", job.Simulation.Script.UserMessage)
}
