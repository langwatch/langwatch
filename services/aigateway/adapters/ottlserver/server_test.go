package ottlserver

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap/zaptest"
)

// canonicalClaudeCodeStatements mirrors the 9-statement starter in
// `langwatch/ee/governance/services/activity-monitor/ottlStarterTemplates.ts`.
// Keep these in sync — the contract is that applying THESE statements
// to a captured Claude Code OTLP/JSON payload yields the canonical
// `langwatch.*` fields the cost ledger reads from.
var canonicalClaudeCodeStatements = []string{
	`set(attributes["langwatch.cost.usd"], attributes["cost_usd"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.request_id"], attributes["request_id"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.model"], attributes["model"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.input_tokens"], attributes["input_tokens"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.output_tokens"], attributes["output_tokens"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.cache_read_tokens"], attributes["cache_read_tokens"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.cache_creation_tokens"], attributes["cache_creation_tokens"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.principal.email"], attributes["user.email"]) where attributes["event.name"] == "api_request"`,
	`set(attributes["langwatch.team.id_hint"], resource.attributes["team.id"]) where attributes["event.name"] == "api_request"`,
}

func TestServer_HandleValidate_GoodStatements(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(validateRequest{Statements: canonicalClaudeCodeStatements})
	rec := postJSON(t, srv.HandleValidate, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var out validateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.True(t, out.OK, "valid statements should parse cleanly: %#v", out)
	assert.Empty(t, out.Errors)
}

func TestServer_HandleValidate_BadStatement_ReturnsParseError(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	bad := []string{
		`set(attributes["langwatch.cost.usd"], attributes["cost_usd"]) where attributes["event.name"] == "api_request"`, // good
		`set(attributes[)`, // malformed — unbalanced bracket
	}
	body, _ := json.Marshal(validateRequest{Statements: bad})
	rec := postJSON(t, srv.HandleValidate, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var out validateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.False(t, out.OK)
	require.Len(t, out.Errors, 1, "only the second statement is malformed")
	assert.Equal(t, 1, out.Errors[0].StatementIndex)
	assert.NotEmpty(t, out.Errors[0].Message)
}

// TestServer_HandleTransform_ClaudeCodeFixture is the canonical
// proof point: feed Ariana's recorded Claude Code OTLP capture
// through the canonical 9-statement starter, then assert the
// mutated payload carries every expected `langwatch.*` attribute.
func TestServer_HandleTransform_ClaudeCodeFixture(t *testing.T) {
	t.Parallel()
	fixturePath, ok := locateFixture("specs/ai-governance/ingestion-sources/fixtures/claude-code-2.1.129-otlp-capture.jsonl")
	if !ok {
		t.Skip("fixture not committed (recorded capture lives in a separate artifact store); skipping until the fixture lands in the tree")
	}
	bodies := loadOtlpLogBodies(t, fixturePath)
	require.NotEmpty(t, bodies, "fixture must contain at least one POST /v1/logs body")

	srv := mustNew(t)

	totalRecords := 0
	totalApiRequests := 0
	for _, body := range bodies {
		req := transformRequest{
			SourceID:   "fixture-claude-code",
			Kind:       "log",
			Encoding:   "json",
			PayloadB64: base64.StdEncoding.EncodeToString(body),
			Statements: canonicalClaudeCodeStatements,
		}
		reqBody, _ := json.Marshal(req)

		rec := postJSON(t, srv.HandleTransform, reqBody)
		require.Equalf(t, http.StatusOK, rec.Code, "transform call failed: %s", rec.Body.String())

		var resp transformResponse
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		require.Truef(t, resp.OK, "transform returned errors: %#v", resp.Errors)
		require.Equal(t, "json", resp.Encoding)

		mutated, err := base64.StdEncoding.DecodeString(resp.PayloadB64)
		require.NoError(t, err)

		u := plog.JSONUnmarshaler{}
		logs, err := u.UnmarshalLogs(mutated)
		require.NoError(t, err)

		records, apiRequests := walk(t, logs)
		totalRecords += records
		totalApiRequests += apiRequests
	}

	require.Positive(t, totalApiRequests, "fixture must include at least one claude_code.api_request record; got 0")
	t.Logf("examined %d log records (%d api_request) across %d batches", totalRecords, totalApiRequests, len(bodies))
}

// walk asserts that every log record carrying `event.name = "api_request"`
// has been enriched with the canonical langwatch.* fields by the
// transform. Returns (totalRecords, apiRequestRecords).
func walk(t *testing.T, logs plog.Logs) (int, int) {
	t.Helper()
	totalRecords := 0
	apiRequests := 0

	rls := logs.ResourceLogs()
	for i := 0; i < rls.Len(); i++ {
		rl := rls.At(i)
		resourceAttrs := rl.Resource().Attributes()
		teamID, hasTeamID := resourceAttrs.Get("team.id")

		sls := rl.ScopeLogs()
		for j := 0; j < sls.Len(); j++ {
			sl := sls.At(j)
			lrs := sl.LogRecords()
			for k := 0; k < lrs.Len(); k++ {
				totalRecords++
				lr := lrs.At(k)
				attrs := lr.Attributes()
				eventName, _ := attrs.Get("event.name")
				if eventName.Str() != "api_request" {
					continue
				}
				apiRequests++

				// Required signals — extractor used to drop any record
				// missing cost_usd or request_id.
				assertCopiedAttr(t, attrs, "langwatch.cost.usd", "cost_usd")
				assertCopiedAttr(t, attrs, "langwatch.request_id", "request_id")

				// Optional but expected in the captured fixture.
				assertCopiedAttr(t, attrs, "langwatch.model", "model")
				assertCopiedAttr(t, attrs, "langwatch.input_tokens", "input_tokens")
				assertCopiedAttr(t, attrs, "langwatch.output_tokens", "output_tokens")
				assertCopiedAttrIfPresent(t, attrs, "langwatch.cache_read_tokens", "cache_read_tokens")
				assertCopiedAttrIfPresent(t, attrs, "langwatch.cache_creation_tokens", "cache_creation_tokens")

				// principal.email comes from the event's user.email when
				// present; the fixture from CC 2.1.129 carries it.
				if email, ok := attrs.Get("user.email"); ok {
					gotEmail, ok2 := attrs.Get("langwatch.principal.email")
					require.True(t, ok2, "user.email is set but langwatch.principal.email was not propagated")
					assert.Equal(t, email.AsString(), gotEmail.AsString())
				}

				// team.id_hint is a resource attribute → log attribute promotion.
				if hasTeamID {
					gotTeam, ok := attrs.Get("langwatch.team.id_hint")
					require.True(t, ok, "resource team.id was set but langwatch.team.id_hint was not promoted")
					assert.Equal(t, teamID.AsString(), gotTeam.AsString())
				}
			}
		}
	}
	return totalRecords, apiRequests
}

func assertCopiedAttr(t *testing.T, attrs pcommon.Map, dest, source string) {
	t.Helper()
	src, srcOK := attrs.Get(source)
	dst, dstOK := attrs.Get(dest)
	if !srcOK {
		t.Fatalf("source attribute %q missing on api_request record (fixture invariant violated)", source)
	}
	require.Truef(t, dstOK, "dest attribute %q was not populated by OTTL", dest)
	assert.Equalf(t, src.AsString(), dst.AsString(), "OTTL did not copy %q→%q faithfully", source, dest)
}

func assertCopiedAttrIfPresent(t *testing.T, attrs pcommon.Map, dest, source string) {
	t.Helper()
	src, ok := attrs.Get(source)
	if !ok {
		return
	}
	dst, ok2 := attrs.Get(dest)
	require.Truef(t, ok2, "dest attribute %q was not populated despite source %q being present", dest, source)
	assert.Equalf(t, src.AsString(), dst.AsString(), "OTTL did not copy %q→%q faithfully", source, dest)
}

// ── fixture loading ─────────────────────────────────────────────────

type capturedRequest struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	BodyEncoding string `json:"body_encoding"`
	Body         string `json:"body"`
}

// loadOtlpLogBodies extracts every POST /v1/logs body from a JSONL
// HTTP capture and returns the raw OTLP/JSON bytes ready to feed
// to the transform endpoint.
func loadOtlpLogBodies(t *testing.T, path string) [][]byte {
	t.Helper()
	f, err := os.Open(path)
	require.NoError(t, err, "open fixture")
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 4*1024*1024)
	var out [][]byte
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req capturedRequest
		if err := json.Unmarshal(line, &req); err != nil {
			t.Fatalf("malformed fixture line: %v", err)
		}
		if req.Method != http.MethodPost || !strings.HasSuffix(req.Path, "/v1/logs") {
			continue
		}
		switch req.BodyEncoding {
		case "utf8":
			out = append(out, []byte(req.Body))
		case "base64":
			decoded, err := base64.StdEncoding.DecodeString(req.Body)
			require.NoError(t, err)
			out = append(out, decoded)
		default:
			t.Fatalf("unsupported body_encoding %q", req.BodyEncoding)
		}
	}
	require.NoError(t, scanner.Err())
	return out
}

// locateFixture walks up from the test's working directory to find a
// fixture file. Returns ok=false when the fixture is missing so callers
// can decide to skip (e.g. for fixtures stored outside the repo).
// Lets the test run from the package directory or from the repo root
// without dancing with relative paths.
func locateFixture(rel string) (string, bool) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", false
	}
	dir := cwd
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, rel)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", false
}

// ── helpers ─────────────────────────────────────────────────────────

func mustNew(t *testing.T) *Server {
	t.Helper()
	s, err := New(zaptest.NewLogger(t))
	require.NoError(t, err)
	return s
}

func postJSON(t *testing.T, h func(http.ResponseWriter, *http.Request), body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}
