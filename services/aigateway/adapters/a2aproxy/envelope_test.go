package a2aproxy

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

// @scenario "a JSON-RPC envelope that names a member twice or in another case is refused"
func TestAmbiguousJSONRPCEnvelopeIsRefused(t *testing.T) {
	for name, body := range map[string]string{
		"method in another case after it": `{"jsonrpc":"2.0","id":7,"method":"admin/drop_all","Method":"SendMessage","params":{}}`,
		"method in another case before":   `{"jsonrpc":"2.0","id":7,"METHOD":"SendMessage","method":"admin/drop_all","params":{}}`,
		"method only in another case":     `{"jsonrpc":"2.0","id":7,"Method":"SendMessage","params":{}}`,
		"method twice, allowed one last":  `{"jsonrpc":"2.0","id":7,"method":"admin/drop_all","method":"SendMessage","params":{}}`,
		"method twice, allowed one first": `{"jsonrpc":"2.0","id":7,"method":"SendMessage","method":"admin/drop_all","params":{}}`,
		"id twice":                        `{"jsonrpc":"2.0","id":7,"id":8,"method":"SendMessage","params":{}}`,
		"id in another case":              `{"jsonrpc":"2.0","ID":7,"method":"SendMessage","params":{}}`,
		"jsonrpc twice":                   `{"jsonrpc":"2.0","jsonrpc":"1.0","method":"SendMessage","id":7,"params":{}}`,
		"jsonrpc with a folding rune":     `{"jſonrpc":"2.0","id":7,"method":"SendMessage","params":{}}`,
		"params twice":                    `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{},"params":{"x":1}}`,
		"params in another case":          `{"jsonrpc":"2.0","id":7,"method":"SendMessage","Params":{}}`,
		"trailing value":                  `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{}} {"method":"admin/drop_all"}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			rec := f.do(http.MethodPost, "/a2a/billing", body)

			code, reason, _ := rpcError(t, rec)
			assert.Equal(t, -32600, code)
			assert.Equal(t, "a2a_invalid_request", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

// @scenario "a JSON-RPC envelope that names a member twice or in another case is refused"
func TestPlainJSONRPCEnvelopeStillPasses(t *testing.T) {
	for name, body := range map[string]string{
		"members in any order": `{"params":{"message":{"messageId":"m1","parts":[{"text":"hi"}]}},"method":"SendMessage","id":"r-1","jsonrpc":"2.0"}`,
		"escaped member name":  `{"jsonrpc":"2.0","id":7,"m\u0065thod":"SendMessage","params":{}}`,
		"no params and no id":  `{"jsonrpc":"2.0","method":"GetTask"}`,
		"nested Method key":    `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{"metadata":{"Method":"x","method":"y"}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			rec := f.do(http.MethodPost, "/a2a/billing", body)

			assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.NotContains(t, rec.Body.String(), `"error"`)
			assert.Len(t, f.upstreamCalls(), 1)
		})
	}
}

// @scenario "a JSON-RPC method that is not an A2A method is refused"
func TestUnknownJSONRPCMethodIsRefusedBeforeTheUpstream(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"admin/drop_all"}`)
	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32601, code)
	assert.Equal(t, "a2a_operation_not_supported", reason)
	assert.Empty(t, f.upstreamCalls())

	rec = f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"message/send","params":{}}`)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}
