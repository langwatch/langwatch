package ottlserver

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/plog"
)

// emptyOtlpJsonLogs returns the smallest valid OTLP/JSON Logs payload
// — single empty ResourceLogs container, no records. Used as a "valid
// wire shape, no records to mutate" canary for codec edge cases.
//
// Note we add a ResourceLogs even though we want "no records" — a
// fully-empty plog.Logs proto-marshals to 0 bytes, which the receive
// handler correctly rejects as missing_payload. Adding the empty
// container produces a non-zero byte stream while still carrying no
// log records to mutate.
func emptyOtlpJsonLogs(t *testing.T) []byte {
	t.Helper()
	logs := plog.NewLogs()
	logs.ResourceLogs().AppendEmpty()
	m := plog.JSONMarshaler{}
	out, err := m.MarshalLogs(logs)
	require.NoError(t, err)
	return out
}

// emptyOtlpProtoLogs is the proto twin of emptyOtlpJsonLogs.
func emptyOtlpProtoLogs(t *testing.T) []byte {
	t.Helper()
	logs := plog.NewLogs()
	logs.ResourceLogs().AppendEmpty()
	m := plog.ProtoMarshaler{}
	out, err := m.MarshalLogs(logs)
	require.NoError(t, err)
	require.NotEmpty(t, out, "proto-marshaled non-empty Logs must produce non-zero bytes")
	return out
}

func TestServer_HandleTransform_InvalidBase64(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-1",
		Kind:       "log",
		Encoding:   "json",
		PayloadB64: "@not-valid-base64@",
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_payload_b64")
}

func TestServer_HandleTransform_MissingPayload(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-2",
		Kind:       "log",
		Encoding:   "json",
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "missing_payload")
}

func TestServer_HandleTransform_LegacyPayloadFieldStillReads(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Senders on the older sergey contract POST under `payload_proto_b64`.
	// The handler must still accept this for one release of overlap so a
	// stale TS client doesn't break the moment a new gateway ships.
	payload := emptyOtlpJsonLogs(t)
	body, _ := json.Marshal(transformRequest{
		SourceID:         "neg-legacy",
		Kind:             "log",
		Encoding:         "json",
		LegacyPayloadB64: base64.StdEncoding.EncodeToString(payload),
		Statements:       []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp transformResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.OK)
}

func TestServer_HandleTransform_InvalidEncoding(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-3",
		Kind:       "log",
		Encoding:   "yaml",
		PayloadB64: base64.StdEncoding.EncodeToString([]byte("{}")),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_encoding")
}

func TestServer_HandleTransform_DefaultEncodingIsProto(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Encoding omitted from the request — defaults to proto. Send a
	// proto-encoded payload to confirm the handler dispatches to the
	// right unmarshaler.
	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-default-encoding",
		Kind:       "log",
		PayloadB64: base64.StdEncoding.EncodeToString(emptyOtlpProtoLogs(t)),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp transformResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.OK)
	assert.Equal(t, "proto", resp.Encoding)
}

func TestServer_HandleTransform_ProtoBytesWithJsonEncodingFails(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Caller declared encoding=json but sent proto-encoded bytes.
	// The codec mismatch should surface as invalid_otlp_payload, not
	// silently produce wrong results downstream.
	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-codec-mismatch",
		Kind:       "log",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString(emptyOtlpProtoLogs(t)),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_otlp_payload")
}

func TestServer_HandleTransform_EmptyStatementsRoundTrips(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Empty statement list is a legal no-op — the gateway should
	// re-marshal the payload unchanged. Useful for callers that want
	// to round-trip through the gateway as a pdata validator without
	// applying any mutation.
	payload := emptyOtlpJsonLogs(t)
	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-empty-stmts",
		Kind:       "log",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString(payload),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp transformResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.OK)
	assert.Equal(t, "json", resp.Encoding)
	assert.NotEmpty(t, resp.PayloadB64)
}

func TestServer_HandleTransform_UnknownFunctionParseError(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Reference a function that ottlfuncs.StandardFuncs doesn't ship.
	// Should surface as a per-statement parse error, not a 500.
	payload := emptyOtlpJsonLogs(t)
	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-unknown-fn",
		Kind:       "log",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString(payload),
		Statements: []string{
			`flibbertigibbet(attributes["x"])`,
		},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp transformResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.False(t, resp.OK, "unknown function should not pass parse")
	require.Len(t, resp.Errors, 1)
	assert.Equal(t, 0, resp.Errors[0].StatementIndex)
	assert.NotEmpty(t, resp.Errors[0].Message)
}

func TestServer_HandleTransform_MetricKindUnsupported(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-metric",
		Kind:       "metric",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString([]byte("{}")),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusNotImplemented, rec.Code)
	assert.Contains(t, rec.Body.String(), "metric_transform_unsupported")
}

func TestServer_HandleTransform_UnknownKindRejected(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-bad-kind",
		Kind:       "trace",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString([]byte("{}")),
		Statements: []string{},
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_kind")
}

func TestServer_HandleTransform_MalformedJsonBody(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Caller sent a request body that isn't valid JSON at all.
	rec := postJSON(t, srv.HandleTransform, []byte(`{not actually json`))

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_json")
}

func TestServer_HandleTransform_LargeStatementListStillWorks(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// 100 valid statements — each a no-op-ish set on a key the where
	// clause never matches, so no record-side mutation. Probes the
	// parser's per-statement allocator + the iteration cost.
	stmts := make([]string, 100)
	for i := range stmts {
		stmts[i] = `set(attributes["langwatch.cost.usd"], 0.0) where attributes["never.matches"] == "x"`
	}

	payload := emptyOtlpJsonLogs(t)
	body, _ := json.Marshal(transformRequest{
		SourceID:   "neg-stmts-100",
		Kind:       "log",
		Encoding:   "json",
		PayloadB64: base64.StdEncoding.EncodeToString(payload),
		Statements: stmts,
	})
	rec := postJSON(t, srv.HandleTransform, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var resp transformResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.True(t, resp.OK, "100 valid statements should parse + execute without errors: %#v", resp.Errors)
}

func TestServer_HandleValidate_EmptyStatementsTreatedAsOk(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	body, _ := json.Marshal(validateRequest{Statements: []string{}})
	rec := postJSON(t, srv.HandleValidate, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var out validateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.True(t, out.OK, "empty statement list is trivially valid")
}

func TestServer_HandleValidate_MalformedJsonBody(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	rec := postJSON(t, srv.HandleValidate, []byte(`{"statements": [unterminated`))

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_json")
}

func TestServer_HandleValidate_PerStatementIndicesPreservedOnInterleavedErrors(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	// Mix valid + invalid statements across the list to make sure the
	// errors[].statement_index reflects original position, not "Nth
	// failure". Critical for the OttlEditor red-dot UI to mark the
	// correct row.
	stmts := []string{
		`set(attributes["a"], "x")`, // 0 — valid
		`???bad???`,                 // 1 — invalid
		`set(attributes["b"], "y")`, // 2 — valid
		`set(`,                      // 3 — invalid
	}
	body, _ := json.Marshal(validateRequest{Statements: stmts})
	rec := postJSON(t, srv.HandleValidate, body)

	require.Equal(t, http.StatusOK, rec.Code)
	var out validateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	require.False(t, out.OK)
	require.Len(t, out.Errors, 2)
	indices := []int{out.Errors[0].StatementIndex, out.Errors[1].StatementIndex}
	assert.ElementsMatch(t, []int{1, 3}, indices,
		"per-statement error indices must reflect the original statement positions")

	// Both error messages should be non-empty (we surface the parser
	// text verbatim — no swallowed errors).
	for _, e := range out.Errors {
		assert.NotEmpty(t, strings.TrimSpace(e.Message))
	}
}
