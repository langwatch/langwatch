package httpapi

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

func TestSetMetaHeaders_TraceIDHeaderNamesTheCustomerTrace(t *testing.T) {
	w := httptest.NewRecorder()
	w.Header().Set(gatewaytracer.HeaderTraceID, "ops")

	setMetaHeaders(w, app.DispatchMeta{
		CustomerTraceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
	})

	assert.Equal(t, "0af7651916cd43dd8448eb211c80319c", w.Header().Get(gatewaytracer.HeaderTraceID))
	assert.Equal(t, "b7ad6b7169203331", w.Header().Get(gatewaytracer.HeaderSpanID))
}
