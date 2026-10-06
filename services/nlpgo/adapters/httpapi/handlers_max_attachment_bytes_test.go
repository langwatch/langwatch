package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

func decodeForMaxAttachmentBytes(t *testing.T, body, header string) *app.WorkflowRequest {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	if header != "" {
		r.Header.Set("X-LangWatch-Max-Attachment-Bytes", header)
	}
	req, herrErr := decodeStudioClientEvent(r, []byte(body))
	require.Nil(t, herrErr)
	return req
}

const workflowJSON = `{"workflow_id": "wf", "api_key": "k", "spec_version": "1.3"}`

// @scenario "The limit is read from the request payload"
func TestDecodeStudioClientEvent_MaxAttachmentBytes_FromPayload(t *testing.T) {
	discriminated := `{"type": "execute_flow", "payload": {"trace_id": "abc", "workflow": ` + workflowJSON + `, "max_attachment_bytes": 104857600}}`
	flat := `{"trace_id": "abc", "workflow": ` + workflowJSON + `, "max_attachment_bytes": 104857600}`

	for name, body := range map[string]string{"discriminated event": discriminated, "flat envelope": flat} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, int64(104857600), decodeForMaxAttachmentBytes(t, body, "").MaxAttachmentBytes)
			// The payload wins over the header when both name a limit.
			assert.Equal(t, int64(104857600), decodeForMaxAttachmentBytes(t, body, "5242880").MaxAttachmentBytes)
		})
	}
}

// @scenario "The limit falls back to the request header when the payload names none"
func TestDecodeStudioClientEvent_MaxAttachmentBytes_HeaderFallback(t *testing.T) {
	absent := `{"type": "execute_flow", "payload": {"trace_id": "abc", "workflow": ` + workflowJSON + `}}`
	zero := `{"type": "execute_flow", "payload": {"trace_id": "abc", "workflow": ` + workflowJSON + `, "max_attachment_bytes": 0}}`

	cases := []struct {
		name   string
		body   string
		header string
		want   int64
	}{
		{"absent in payload, header set", absent, "52428800", 52428800},
		{"zero in payload, header set", zero, "52428800", 52428800},
		{"header padded with spaces", absent, " 52428800 ", 52428800},
		{"neither names a limit", absent, "", 0},
		{"header is not a number", absent, "plenty", 0},
		{"header is a decimal fraction", absent, "5.5", 0},
		{"header is negative", absent, "-1", 0},
		{"header is zero", absent, "0", 0},
		{"header overflows", absent, "99999999999999999999999", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, decodeForMaxAttachmentBytes(t, tc.body, tc.header).MaxAttachmentBytes)
		})
	}
}
