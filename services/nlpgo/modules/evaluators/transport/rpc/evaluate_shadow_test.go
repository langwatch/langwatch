package rpc_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	evalrpc "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/rpc"
)

func TestIsShadowCallReadsTheShadowHeader(t *testing.T) {
	for value, want := range map[string]bool{"1": true, "true": true, "TRUE": true, "": false, "0": false, "no": false} {
		r := httptest.NewRequest(http.MethodPost, "/go/evaluators/langevals/exact_match/evaluate", nil)
		if value != "" {
			r.Header.Set(evalrpc.HeaderShadow, value)
		}
		assert.Equal(t, want, evalrpc.IsShadowCall(r), "header %q", value)
	}
}
