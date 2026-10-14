package services_test

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

const piiSlug = "presidio/pii_detection"

// piiShortOfParity are recorded cases the pattern port answers differently,
// each for a reason in the handoff; they are reported, not failed.
func piiShortOfParity() []string {
	return []string{}
}

// @scenario "Pattern PII findings match Presidio's, scores included"
func TestReplayPIIPatternsAnswerWhatPresidioAnswered(t *testing.T) {
	h := newPIIHarness(t, nil)
	var differing []string
	for _, c := range piiFixture(t, "presidio__pii_detection.json") {
		got := h.evaluate(t, c)
		if slices.Contains(piiShortOfParity(), c.Name) {
			if !samePIIResult(t, c.Result, got) {
				differing = append(differing, c.Name)
			}
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			assertPIIResult(t, c.Result, got)
		})
	}
	for _, name := range differing {
		t.Logf("presidio/pii_detection short of parity: %q", name)
	}
}

// @scenario "PERSON or LOCATION without a configured PII model is an entry error, not a pass"
func TestPIIPersonWithoutModelIsAnEntryError(t *testing.T) {
	h := newPIIHarness(t, nil)
	got := h.evaluate(t, piiCase(`{"entities":{"person":true}}`, "My name is John Smith."))
	assert.Equal(t, contract.StatusError, got.Status)
	assert.Equal(t, "PIIModelNotConfigured", got.ErrorType)
	require.NotNil(t, got.Details)
	assert.Equal(t, "PERSON and LOCATION detection needs a PII model; none is configured", *got.Details)
	assert.Nil(t, got.Passed)
}

// Presidio's limit is len(content) > 524288 in Python characters, so runes here.
func TestPIIContentOverTheSizeLimitIsAnEntryError(t *testing.T) {
	h := newPIIHarness(t, nil)
	atLimit := h.evaluate(t, piiCase(`{}`, strings.Repeat("é", rules.PIIMaxContentChars)))
	assert.Equal(t, contract.StatusProcessed, atLimit.Status)
	over := h.evaluate(t, piiCase(`{}`, strings.Repeat("é", rules.PIIMaxContentChars+1)))
	assert.Equal(t, contract.StatusError, over.Status)
	require.NotNil(t, over.Details)
	assert.Equal(t, "Content exceeds the maximum length of 524288 bytes allowed by PII Detection", *over.Details)
}

// @scenario "Only entities patterns cannot find are sent to the PII model"
func TestPIIModelIsAskedOnlyForWhatPatternsCannotFind(t *testing.T) {
	analyzer := memory.NewPIIAnalyzer("PERSON", "LOCATION", "EMAIL_ADDRESS")
	h := newPIIHarness(t, analyzer)
	h.evaluate(t, piiCase(`{"entities":{"person":true,"email_address":true,"credit_card":false,"crypto":false,"iban_code":false,"ip_address":false,"phone_number":false,"medical_license":false}}`, "Maria at maria@example.com"))
	requests := analyzer.Requests()
	require.Len(t, requests, 1)
	assert.Equal(t, []contract.EntityType{"PERSON"}, requests[0].Entities)
	assert.Equal(t, "project_replay", requests[0].ProjectID)

	h.evaluate(t, piiCase(`{}`, "maria@example.com"))
	assert.Len(t, analyzer.Requests(), 1, "defaults need no model")
}

// The NER fixture's PERSON and LOCATION answers, replayed through the model twin.
func TestReplayPIIModelFindingsAnswerWhatPresidioAnswered(t *testing.T) {
	cases := piiFixture(t, "presidio__pii_detection_ner.json")
	analyzer := memory.NewPIIAnalyzer("PERSON", "LOCATION")
	byText := map[string][]contract.PIIFinding{}
	for _, c := range cases {
		for _, r := range piiRawResults(t, c.Result.RawResponse) {
			if r.Recognizer == "SpacyRecognizer" {
				byText[*c.Entry.Output] = append(byText[*c.Entry.Output], r.PIIFinding)
			}
		}
	}
	analyzer.Script(func(_ context.Context, req channels.AnalyzeRequest) (channels.AnalyzeResult, error) {
		return channels.AnalyzeResult{Findings: byText[req.Text]}, nil
	})
	h := newPIIHarness(t, analyzer)
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			assertPIIResult(t, c.Result, h.evaluate(t, c))
		})
	}
}

// @scenario "Entry text never reaches a log or a LangWatch span"
func TestPIIEntryTextNeverReachesALogOrSpan(t *testing.T) {
	const secret = "maria.secret@example.com"
	analyzer := memory.NewPIIAnalyzer("PERSON", "LOCATION")
	analyzer.Script(func(context.Context, channels.AnalyzeRequest) (channels.AnalyzeResult, error) {
		return channels.AnalyzeResult{}, assert.AnError
	})
	h := newPIIHarness(t, analyzer)
	for _, settings := range []string{`{}`, `{"entities":{"person":true}}`} {
		got := h.evaluate(t, piiCase(settings, "Maria Secret "+secret))
		if got.Details != nil {
			assert.NotContains(t, *got.Details, "Maria Secret", "details")
		}
	}
	for _, entry := range h.logs.All() {
		assert.NotContains(t, entry.Message, secret)
		for key, value := range entry.ContextMap() {
			assert.NotContains(t, key+"="+toJSON(t, value), secret)
		}
	}
	for _, span := range h.spans.GetSpans() {
		for _, attr := range span.Attributes {
			assert.NotContains(t, attr.Value.String(), secret, "span %s", span.Name)
		}
		for _, event := range span.Events {
			for _, attr := range event.Attributes {
				assert.NotContains(t, attr.Value.String(), secret, "span event %s", span.Name)
			}
		}
	}
}

type piiHarness struct {
	service *services.EvaluationService
	spans   *tracetest.InMemoryExporter
	logs    *observer.ObservedLogs
}

func newPIIHarness(t *testing.T, analyzer channels.PIIAnalyzer) piiHarness {
	t.Helper()
	spans := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(spans))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	core, logs := observer.New(zap.DebugLevel)
	deps := services.EvaluationDeps{
		Config:        contract.DefaultConfig(),
		LLM:           memory.NewLLM(),
		CustomerTrace: memory.NewCustomerTrace(),
		OpsTracer:     provider.Tracer("test"),
		Logger:        zap.New(core),
	}
	if analyzer != nil {
		deps.PIIAnalyzer = analyzer
	}
	return piiHarness{service: services.NewEvaluationService(deps), spans: spans, logs: logs}
}

func (h piiHarness) evaluate(t *testing.T, c fixtureCase) contract.Result {
	t.Helper()
	results, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "project_replay"},
		Evaluator: piiSlug,
		Entries:   []contract.Entry{c.Entry},
		Settings:  settingsOrEmpty(c.Settings),
	})
	require.NoError(t, err)
	require.Len(t, results, 1)
	return results[0]
}

func piiCase(settings, output string) fixtureCase {
	return fixtureCase{Settings: json.RawMessage(settings), Entry: contract.Entry{Output: &output}}
}

func piiFixture(t *testing.T, file string) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", file))
	require.NoError(t, err)
	var cases []fixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	return cases
}

// piiRawResult is one raw_response.results item, read back.
type piiRawResult struct {
	contract.PIIFinding
	Recognizer string
}

type piiRaw struct {
	Anonymized string `json:"anonymized"`
	Results    []struct {
		contract.PIIFinding
		RecognitionMetadata struct {
			RecognizerName string `json:"recognizer_name"`
		} `json:"recognition_metadata"`
	} `json:"results"`
}

func piiRawResults(t *testing.T, raw json.RawMessage) []piiRawResult {
	t.Helper()
	var parsed piiRaw
	require.NoError(t, json.Unmarshal(raw, &parsed))
	out := make([]piiRawResult, len(parsed.Results))
	for i, r := range parsed.Results {
		out[i] = piiRawResult{PIIFinding: r.PIIFinding, Recognizer: r.RecognitionMetadata.RecognizerName}
	}
	return out
}

// piiComparable is a result with Python's set-ordered ties sorted and the
// recognizer identifiers (memory addresses in Python) left out.
type piiComparable struct {
	Status     contract.Status
	Score      *float64
	Passed     *bool
	ErrorType  string
	Details    string
	Anonymized string
	Findings   []contract.PIIFinding
}

func comparablePII(t *testing.T, status contract.Status, score *float64, passed *bool, errorType, details *string, raw json.RawMessage) piiComparable {
	t.Helper()
	c := piiComparable{Status: status, Score: score, Passed: passed}
	if errorType != nil {
		c.ErrorType = *errorType
	}
	if details != nil {
		head, list, found := strings.Cut(*details, ": ")
		if found && head == "PII detected" {
			parts := strings.Split(list, ", ")
			sort.Strings(parts)
			c.Details = head + ": " + strings.Join(parts, ", ")
		} else {
			c.Details = *details
		}
	}
	if len(raw) > 0 && string(raw) != "null" {
		var parsed piiRaw
		require.NoError(t, json.Unmarshal(raw, &parsed))
		c.Anonymized = parsed.Anonymized
		for _, r := range parsed.Results {
			c.Findings = append(c.Findings, r.PIIFinding)
		}
		sort.Slice(c.Findings, func(i, j int) bool {
			a, b := c.Findings[i], c.Findings[j]
			if a.Start != b.Start {
				return a.Start < b.Start
			}
			if a.End != b.End {
				return a.End < b.End
			}
			return a.EntityType < b.EntityType
		})
	}
	return c
}

func wantPII(t *testing.T, want fixtureResult) piiComparable {
	t.Helper()
	return comparablePII(t, want.Status, want.Score, want.Passed, want.ErrorType, want.Details, want.RawResponse)
}

func gotPII(t *testing.T, got contract.Result) piiComparable {
	t.Helper()
	var errorType *string
	if got.ErrorType != "" {
		errorType = &got.ErrorType
	}
	return comparablePII(t, got.Status, got.Score, got.Passed, errorType, got.Details, got.RawResponse)
}

func assertPIIResult(t *testing.T, want fixtureResult, got contract.Result) {
	t.Helper()
	w, g := wantPII(t, want), gotPII(t, got)
	assert.Equal(t, w.Status, g.Status, "status")
	assert.Equal(t, w.ErrorType, g.ErrorType, "error_type")
	assert.Equal(t, w.Details, g.Details, "details")
	assert.Equal(t, w.Passed, g.Passed, "passed")
	assertFloat(t, w.Score, g.Score, 0, "score")
	assert.Equal(t, w.Anonymized, g.Anonymized, "anonymized")
	assert.True(t, sameFindings(w.Findings, g.Findings), "findings: want %v, got %v", w.Findings, g.Findings)
}

func samePIIResult(t *testing.T, want fixtureResult, got contract.Result) bool {
	t.Helper()
	w, g := wantPII(t, want), gotPII(t, got)
	return w.Status == g.Status && w.ErrorType == g.ErrorType && w.Details == g.Details &&
		samePointee(w.Passed, g.Passed) && samePointee(w.Score, g.Score) && w.Anonymized == g.Anonymized && sameFindings(w.Findings, g.Findings)
}

func sameFindings(want, got []contract.PIIFinding) bool {
	return slices.EqualFunc(want, got, func(a, b contract.PIIFinding) bool {
		return a.EntityType == b.EntityType && a.Start == b.Start && a.End == b.End && math.Abs(a.Score-b.Score) < 1e-12
	})
}

func toJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	return string(raw)
}
