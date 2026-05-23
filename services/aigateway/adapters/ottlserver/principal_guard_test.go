package ottlserver

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/plog"
)

// Pins the post-auth principal-field guard contract end-to-end:
//
//   1. An OTTL rule that overwrites a protected resource attribute
//      is reverted post-transform.
//   2. An OTTL rule that overwrites a protected record attribute
//      is reverted post-transform.
//   3. An OTTL rule that ADDS a protected key (where it was absent
//      pre-transform) has the key removed post-transform.
//   4. A protected-key REMOVAL by OTTL is reverted (key restored).
//   5. Non-protected attribute rewrites still take effect — the
//      guard is closed-set, not a blanket block on OTTL output.
//
// Driven through HandleTransform so we exercise the full receiver
// path, not just the helper functions in isolation.

func TestPrincipalGuard_ResourceAttribute_Overwrite_Reverted(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("langwatch.organization_id", "org-real")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.Attributes().PutStr("event.name", "api_request")

	rec := postTransform(t, srv, logs, []string{
		`set(resource.attributes["langwatch.organization_id"], "org-forged") where attributes["event.name"] == "api_request"`,
	})

	require.Equal(t, http.StatusOK, rec.Code)
	out := decodeTransform(t, rec.Body.Bytes())
	rl0 := out.ResourceLogs().At(0)
	got, ok := rl0.Resource().Attributes().Get("langwatch.organization_id")
	require.True(t, ok, "protected key must remain present post-transform")
	assert.Equal(t, "org-real", got.AsString(),
		"OTTL must NOT be able to rewrite a protected resource attribute")
}

func TestPrincipalGuard_RecordAttribute_Overwrite_Reverted(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.Attributes().PutStr("event.name", "api_request")
	lr.Attributes().PutStr("langwatch.user_id", "ariana@acme.test")

	rec := postTransform(t, srv, logs, []string{
		`set(attributes["langwatch.user_id"], "victim@elsewhere.com") where attributes["event.name"] == "api_request"`,
	})

	require.Equal(t, http.StatusOK, rec.Code)
	out := decodeTransform(t, rec.Body.Bytes())
	got, ok := out.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes().Get("langwatch.user_id")
	require.True(t, ok)
	assert.Equal(t, "ariana@acme.test", got.AsString(),
		"OTTL must NOT be able to rewrite langwatch.user_id")
}

func TestPrincipalGuard_OttlAddsProtectedKey_KeyRemovedPostTransform(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.Attributes().PutStr("event.name", "api_request")
	// No `langwatch.virtual_key_id` set pre-OTTL. A misconfigured
	// rule that mints one out of thin air must NOT survive.

	rec := postTransform(t, srv, logs, []string{
		`set(attributes["langwatch.virtual_key_id"], "vk-lw-phantom") where attributes["event.name"] == "api_request"`,
	})

	require.Equal(t, http.StatusOK, rec.Code)
	out := decodeTransform(t, rec.Body.Bytes())
	_, ok := out.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes().Get("langwatch.virtual_key_id")
	assert.False(t, ok,
		"OTTL must NOT be able to ADD a protected key that was absent pre-transform")
}

func TestPrincipalGuard_OttlRemovesProtectedKey_KeyRestored(t *testing.T) {
	t.Parallel()
	srv := mustNew(t)

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.Attributes().PutStr("event.name", "api_request")
	lr.Attributes().PutStr("langwatch.ingestion_source.id", "is-real-id")

	rec := postTransform(t, srv, logs, []string{
		`delete_key(attributes, "langwatch.ingestion_source.id") where attributes["event.name"] == "api_request"`,
	})

	require.Equal(t, http.StatusOK, rec.Code)
	out := decodeTransform(t, rec.Body.Bytes())
	got, ok := out.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes().Get("langwatch.ingestion_source.id")
	require.True(t, ok, "protected key removed by OTTL must be restored")
	assert.Equal(t, "is-real-id", got.AsString())
}

func TestPrincipalGuard_NonProtectedAttribute_StillMutable(t *testing.T) {
	t.Parallel()
	// Closed-set guard: non-protected keys must STILL be writable
	// by OTTL — otherwise the whole transformation pipeline is
	// pointless. Catches a regression where the guard is too broad.
	srv := mustNew(t)

	logs := plog.NewLogs()
	rl := logs.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.Attributes().PutStr("event.name", "api_request")
	lr.Attributes().PutInt("input_tokens", 42)

	rec := postTransform(t, srv, logs, []string{
		`set(attributes["langwatch.input_tokens"], attributes["input_tokens"]) where attributes["event.name"] == "api_request"`,
	})

	require.Equal(t, http.StatusOK, rec.Code)
	out := decodeTransform(t, rec.Body.Bytes())
	got, ok := out.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes().Get("langwatch.input_tokens")
	require.True(t, ok, "non-protected attribute mutation must survive")
	assert.Equal(t, int64(42), got.Int())
}

// ── helpers ─────────────────────────────────────────────────────────

// postTransform marshals the supplied plog.Logs to proto, base64-
// encodes it, and posts to HandleTransform with the given OTTL
// statements.
func postTransform(t *testing.T, srv *Server, logs plog.Logs, statements []string) *httptest.ResponseRecorder {
	t.Helper()
	m := plog.ProtoMarshaler{}
	raw, err := m.MarshalLogs(logs)
	require.NoError(t, err)
	body, err := json.Marshal(transformRequest{
		SourceID:   "is-test",
		Kind:       "log",
		Encoding:   "proto",
		PayloadB64: base64.StdEncoding.EncodeToString(raw),
		Statements: statements,
	})
	require.NoError(t, err)
	return postJSON(t, srv.HandleTransform, body)
}

// decodeTransform unwraps the transformResponse JSON envelope and
// returns the inner plog.Logs payload.
func decodeTransform(t *testing.T, raw []byte) plog.Logs {
	t.Helper()
	var resp transformResponse
	require.NoError(t, json.Unmarshal(raw, &resp))
	require.True(t, resp.OK, "transform must succeed: %#v", resp)
	payload, err := base64.StdEncoding.DecodeString(resp.PayloadB64)
	require.NoError(t, err)
	u := plog.ProtoUnmarshaler{}
	logs, err := u.UnmarshalLogs(payload)
	require.NoError(t, err)
	return logs
}
