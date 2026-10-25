package services_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// @scenario "The rule-based langevals evaluators answer as langevals answered"
func TestReplayLangevalsRulesAnswerWhatLangevalsAnswered(t *testing.T) {
	t.Run("basic", func(t *testing.T) {
		replayFixtures(t, "langevals/basic", "langevals__basic.json", replayOptions{})
	})
	t.Run("competitor_blocklist", func(t *testing.T) {
		replayFixtures(t, "langevals/competitor_blocklist", "langevals__competitor_blocklist.json", replayOptions{})
	})
	t.Run("valid_format at parity", func(t *testing.T) {
		h := newHarness(t, contract.DefaultConfig(), 0)
		for _, c := range validFormatCases(t, true) {
			t.Run(c.Name, func(t *testing.T) {
				got := evaluateValidFormat(t, h, c)
				if c.Result.ErrorType != nil {
					assert.Equal(t, *c.Result.ErrorType, got.ErrorType, "error_type")
				}
				if isSchemaError(&c) {
					// str(SchemaError) is Python's text from its first byte; see the handoff.
					require.NotNil(t, got.Details)
					t.Logf("details differ by design: want %q, got %q", *c.Result.Details, *got.Details)
					c.Result.Details = got.Details
				}
				compareResult(t, &c, got, replayOptions{DetailsPrefix: quotesPythonException})
			})
		}
	})
}

// shortOfParity are the recorded python and sql cases Go answers unlike
// langevals; a change here is a parity change to review.
var shortOfParity = []string{}

// grammarGaps are valid Python 3 and sqlglot SQL that Go's parsers refuse,
// absent from the recording: why the modes stay off parity.
var grammarGaps = map[string]string{
	"python": "name = 'x'\nprint(f\"{name}\")\n",
	"sql":    "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
}

// @scenario "A valid_format mode short of parity is reported, not hidden"
func TestReplayValidFormatReportsModesShortOfParity(t *testing.T) {
	var differ []string
	for _, c := range validFormatCases(t, false) {
		settings, err := rules.ParseValidFormatSettings(settingsOrEmpty(c.Settings))
		require.NoError(t, err)
		got, err := services.ScoreValidFormatPastTheParityGate(context.Background(), settings, services.EntryRun{Entry: c.Entry})
		require.NoError(t, err)
		if !sameVerdict(&c, got) {
			differ = append(differ, c.Name)
		}
	}
	assert.ElementsMatch(t, shortOfParity, differ)
	for format, source := range grammarGaps {
		verdict := rules.ValidFormat(source, rules.ValidFormatSettings{Format: format})
		assert.False(t, verdict.Passed, "%s now parses %q: re-measure parity", format, source)
	}
}

// @scenario "A valid_format mode short of parity is refused so langevals answers it"
func TestValidFormatShortOfParityIsRefused(t *testing.T) {
	prepare := services.BuiltinEvaluators()["langevals/valid_format"].Prepare
	h := newHarness(t, contract.DefaultConfig(), 0)
	for _, format := range []string{"python", "sql"} {
		settings := json.RawMessage(`{"format":"` + format + `"}`)
		_, err := prepare(settings)
		require.ErrorIs(t, err, contract.ErrEvaluatorNotFound, format)

		output := "SELECT 1"
		results, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
			Tenant:    contract.Tenant{ProjectID: "project_replay"},
			Evaluator: "langevals/valid_format",
			Entries:   []contract.Entry{{Output: &output}},
			Settings:  settings,
		})
		require.Error(t, err, format)
		assert.Nil(t, results, "no verdict is answered for %s", format)
	}
	for _, format := range []string{"json", "markdown"} {
		_, err := prepare(json.RawMessage(`{"format":"` + format + `"}`))
		require.NoError(t, err, format)
	}
}

// quotesPythonException marks details that carry Python's own exception text.
func quotesPythonException(c *fixtureCase) bool {
	details := ""
	if c.Result.Details != nil {
		details = *c.Result.Details
	}
	for _, prefix := range []string{"Invalid JSON", "Invalid JSON Schema", "JSON Schema validation failed", "Invalid Python", "Invalid SQL"} {
		if strings.HasPrefix(details, prefix+":") {
			return true
		}
	}
	return false
}

func isSchemaError(c *fixtureCase) bool {
	return c.Result.ErrorType != nil && *c.Result.ErrorType == "SchemaError"
}

// validFormatCases are the recorded valid_format cases whose mode is (or is
// not) marked at parity in rules.FormatAtParity.
func validFormatCases(t *testing.T, atParity bool) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", "langevals__valid_format.json"))
	require.NoError(t, err)
	var cases []fixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	var selected []fixtureCase
	for i := range cases {
		settings, err := rules.ParseValidFormatSettings(settingsOrEmpty(cases[i].Settings))
		require.NoError(t, err)
		if rules.FormatAtParity(settings.Format) == atParity {
			selected = append(selected, cases[i])
		}
	}
	require.NotEmpty(t, selected)
	return selected
}

func settingsOrEmpty(settings json.RawMessage) json.RawMessage {
	if len(settings) == 0 {
		return json.RawMessage(`{}`)
	}
	return settings
}

func evaluateValidFormat(t *testing.T, h harness, c fixtureCase) contract.Result {
	t.Helper()
	results, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "project_replay"},
		Evaluator: "langevals/valid_format",
		Entries:   []contract.Entry{c.Entry},
		Settings:  settingsOrEmpty(c.Settings),
	})
	require.NoError(t, err)
	require.Len(t, results, 1)
	return results[0]
}

// sameVerdict compares status, passed, score and details up to Python's
// exception text.
func sameVerdict(c *fixtureCase, got contract.Result) bool {
	want := c.Result
	if want.Status != got.Status || !samePointee(want.Passed, got.Passed) || !samePointee(want.Score, got.Score) {
		return false
	}
	if want.Details == nil || got.Details == nil {
		return want.Details == got.Details
	}
	if quotesPythonException(c) {
		return detailsHead(*want.Details) == detailsHead(*got.Details)
	}
	return *want.Details == *got.Details
}

func samePointee[T comparable](want, got *T) bool {
	if want == nil || got == nil {
		return want == got
	}
	return *want == *got
}
