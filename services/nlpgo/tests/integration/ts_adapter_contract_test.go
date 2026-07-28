// This test is the drift guard between the Go engine and the TypeScript
// SerializedCodeAgentAdapter (langwatch#3439).
//
// The TS adapter classifies user-code failures from this endpoint's response.
// It previously classified against FastAPI's `HTTPException(500, detail=…)`,
// a contract this engine has never served — and nothing caught it, because
// the TS tests mocked the response by hand. Both sides were green; the
// capability was dead in production for months.
//
// The TS side now replays bytes recorded from a real engine
// (langwatch/src/server/scenarios/execution/serialized-adapters/__tests__/
// fixtures/nlpgo-recorded-responses.json). A recording only helps while it
// stays true, so this test re-derives it from the live engine and fails when
// the shape the adapter depends on changes. If it fails, the adapter needs
// updating and the fixture re-recording — in that order.
package integration_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const tsFixtureRelPath = "../../../../langwatch/src/server/scenarios/execution/" +
	"serialized-adapters/__tests__/fixtures/nlpgo-recorded-responses.json"

type tsRecordedResponse struct {
	Status int `json:"status"`
	Body   struct {
		Status string `json:"status"`
		Error  struct {
			NodeID    string `json:"node_id"`
			Type      string `json:"type"`
			Message   string `json:"message"`
			Traceback string `json:"traceback"`
		} `json:"error"`
	} `json:"body"`
}

func loadTSFixture(t *testing.T) map[string]tsRecordedResponse {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(tsFixtureRelPath))
	require.NoError(t, err, "TS adapter fixture missing — path moved?")
	var doc map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &doc))

	out := map[string]tsRecordedResponse{}
	for key, val := range doc {
		if key == "_comment" {
			continue
		}
		var rec tsRecordedResponse
		require.NoError(t, json.Unmarshal(val, &rec), "fixture key %q", key)
		out[key] = rec
	}
	return out
}

/** @scenario "a failing code block is reported as a 200 the TS adapter can classify" */
func TestSync_TSAdapterContract_UserCodeFailureShape(t *testing.T) {
	requirePython(t)
	stack := setupStack(t)
	defer stack.close()

	fixture := loadTSFixture(t)
	recorded, ok := fixture["userCodeRaises"]
	require.True(t, ok, "fixture lost its userCodeRaises case")

	// The TS adapter's headline capability rests on this being 200: it reads
	// `status: "error"` off a SUCCESSFUL response. If this ever becomes a
	// non-2xx, the adapter's engine-failure branch stops firing.
	require.Equal(t, 200, recorded.Status,
		"fixture claims a non-200; the adapter's 200 branch would be dead")

	code := "import httpx\n" +
		"def execute(input):\n" +
		"    raise httpx.TimeoutException(\"The read operation timed out\")\n"
	body := codeWorkflow("ts-adapter-contract", "code_agent", code,
		map[string]any{"input": "hello"}, nil, []string{"output"}, nil)

	// postSync itself requires HTTP 200 — that assertion is the load-bearing
	// half of this test.
	res := postSync(t, stack, body)

	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)

	// Every field the TS classifier and renderer read must still be populated.
	assert.Equal(t, recorded.Body.Error.Type, res.Error.Type,
		"error.type drifted — TS classifyEngineFailure keys on this")
	assert.NotEmpty(t, res.Error.Message, "TS falls back to message when traceback is absent")
	assert.NotEmpty(t, res.Error.Traceback, "TS renders the traceback as the customer-facing detail")
	assert.NotEmpty(t, res.Error.NodeID)

	// The type must not collide with a platform type, or the TS denylist
	// would classify a customer's Python as an infra failure — the exact
	// inversion lw#3439 reports.
	for _, platform := range []string{
		"engine_error", "llm_executor_unavailable", "invalid_workflow", "context_canceled",
	} {
		assert.NotEqual(t, platform, res.Error.Type,
			"a user-code failure took a type the TS adapter treats as infra")
	}
}

/** @scenario "an unparseable workflow is reported with a type the TS adapter treats as infra" */
func TestSync_TSAdapterContract_InvalidWorkflowShape(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	fixture := loadTSFixture(t)
	recorded, ok := fixture["invalidWorkflow"]
	require.True(t, ok, "fixture lost its invalidWorkflow case")
	require.Equal(t, 200, recorded.Status)

	res := postSync(t, stack,
		`{"type":"execute_flow","payload":{"trace_id":"t","workflow":{"nodes":"not-an-array"}}}`)

	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	// The adapter synthesizes the DSL, so this must stay in the TS platform
	// denylist rather than being blamed on the customer's code.
	assert.Equal(t, recorded.Body.Error.Type, res.Error.Type)
	assert.Equal(t, "invalid_workflow", res.Error.Type)
}
