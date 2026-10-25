package services_test

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// fixtureCase is one answer recorded from langevals by testdata/record.
type fixtureCase struct {
	Name     string          `json:"name"`
	Settings json.RawMessage `json:"settings"`
	Entry    contract.Entry  `json:"entry"`
	Result   fixtureResult   `json:"result"`
}

type fixtureResult struct {
	Status      contract.Status `json:"status"`
	Score       *float64        `json:"score"`
	Passed      *bool           `json:"passed"`
	Label       *string         `json:"label"`
	Details     *string         `json:"details"`
	ErrorType   *string         `json:"error_type"`
	RawResponse json.RawMessage `json:"raw_response"`
}

// replayOptions loosen the comparison where langevals' own answer is not
// reproducible: Tolerance for floats, DetailsPrefix for details quoting a
// Python exception message (compared up to the first ':').
type replayOptions struct {
	Tolerance     float64
	DetailsPrefix func(c *fixtureCase) bool
}

// replayFixtures runs every recorded case of one evaluator through the
// service and compares it with langevals' answer.
func replayFixtures(t *testing.T, slug, file string, opts replayOptions) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", file))
	require.NoError(t, err)
	var cases []fixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)

	h := newHarness(t, contract.DefaultConfig(), 0)
	for i := range cases {
		c := &cases[i]
		t.Run(c.Name, func(t *testing.T) {
			settings := c.Settings
			if len(settings) == 0 {
				settings = json.RawMessage(`{}`)
			}
			results, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
				Tenant:    contract.Tenant{ProjectID: "project_replay"},
				Evaluator: slug,
				Entries:   []contract.Entry{c.Entry},
				Settings:  settings,
			})
			require.NoError(t, err)
			require.Len(t, results, 1)
			compareResult(t, c, results[0], opts)
		})
	}
}

func compareResult(t *testing.T, c *fixtureCase, got contract.Result, opts replayOptions) {
	t.Helper()
	want := c.Result
	assert.Equal(t, want.Status, got.Status, "status")
	assertFloat(t, want.Score, got.Score, opts.Tolerance, "score")
	assert.Equal(t, want.Passed, got.Passed, "passed")
	assert.Equal(t, want.Label, got.Label, "label")
	if opts.DetailsPrefix != nil && opts.DetailsPrefix(c) && want.Details != nil && got.Details != nil {
		assert.Equal(t, detailsHead(*want.Details), detailsHead(*got.Details), "details prefix")
	} else {
		assert.Equal(t, want.Details, got.Details, "details")
	}
	if len(want.RawResponse) > 0 && string(want.RawResponse) != "null" {
		assertJSONClose(t, want.RawResponse, got.RawResponse, opts.Tolerance)
	}
}

func detailsHead(details string) string {
	head, _, _ := strings.Cut(details, ":")
	return head
}

func assertFloat(t *testing.T, want, got *float64, tolerance float64, field string) {
	t.Helper()
	if want == nil || got == nil {
		assert.Equal(t, want, got, field)
		return
	}
	assert.LessOrEqual(t, math.Abs(*want-*got), tolerance, "%s: want %v, got %v", field, *want, *got)
}

// assertJSONClose compares two JSON documents, numbers within tolerance.
func assertJSONClose(t *testing.T, want, got json.RawMessage, tolerance float64) {
	t.Helper()
	var w, g any
	require.NoError(t, json.Unmarshal(want, &w))
	require.NoError(t, json.Unmarshal(got, &g), "raw_response: %s", got)
	assert.True(t, jsonClose(w, g, tolerance), "raw_response: want %s, got %s", want, got)
}

func jsonClose(want, got any, tolerance float64) bool {
	switch w := want.(type) {
	case float64:
		g, ok := got.(float64)
		return ok && math.Abs(w-g) <= tolerance
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok || len(g) != len(w) {
			return false
		}
		for key, value := range w {
			if !jsonClose(value, g[key], tolerance) {
				return false
			}
		}
		return true
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return false
		}
		for i := range w {
			if !jsonClose(w[i], g[i], tolerance) {
				return false
			}
		}
		return true
	default:
		return want == got
	}
}

func TestReplayExactMatchAnswersWhatLangevalsAnswered(t *testing.T) {
	replayFixtures(t, "langevals/exact_match", "langevals__exact_match.json", replayOptions{})
}
