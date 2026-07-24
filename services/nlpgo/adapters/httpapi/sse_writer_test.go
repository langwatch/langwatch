// Tests pin the SSE wire format that the Studio TS parser expects:
//
//	data: {"type":"<name>","payload":{...}}\n\n
//
// Iter 17 caught a silent regression: writeSSE used to emit an extra
// `event: <name>\n` line plus payload-only JSON, which made TS's
// post_event parser drop every event with no error. This test exists
// so a future refactor of writeSSE can't bring that bug back.
package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeFlusher wraps httptest.ResponseRecorder to satisfy http.Flusher
// without doing anything (the recorder buffers everything anyway).
type fakeFlusher struct{ *httptest.ResponseRecorder }

func (f *fakeFlusher) Flush() {}

func newRecorder() (*httptest.ResponseRecorder, *fakeFlusher) {
	rec := httptest.NewRecorder()
	return rec, &fakeFlusher{rec}
}

func TestWriteSSE_EmitsDataOnlyFrameWithEmbeddedType(t *testing.T) {
	rec, flusher := newRecorder()
	writeSSE(rec, flusher, "component_state_change", map[string]any{
		"component_id":    "n1",
		"execution_state": map[string]any{"status": "success"},
	})

	body := rec.Body.String()

	// Must NOT contain an `event: <name>` line — the TS parser ignores
	// it, and emitting it once made us lose a whole class of bugs.
	if strings.Contains(body, "event: ") {
		t.Fatalf("writeSSE must not emit `event:` lines; got: %q", body)
	}

	// Must end with the SSE frame terminator.
	if !strings.HasSuffix(body, "\n\n") {
		t.Fatalf("frame must end with \\n\\n; got: %q", body)
	}

	// Must contain exactly one `data:` line.
	dataCount := strings.Count(body, "\ndata: ")
	if strings.HasPrefix(body, "data: ") {
		dataCount++
	}
	if dataCount != 1 {
		t.Fatalf("expected exactly one `data:` line; got %d in %q", dataCount, body)
	}

	// Round-trip parse the way the TS parser does: find `data: `, take
	// the rest of the chunk, JSON-decode.
	frame := decodeSingleSSE(t, body)
	gotType, _ := frame["type"].(string)
	if gotType != "component_state_change" {
		t.Fatalf("type must be embedded in JSON; got %q", gotType)
	}
	payload, _ := frame["payload"].(map[string]any)
	if payload == nil {
		t.Fatalf("payload must be present for non-empty input; frame=%v", frame)
	}
	if got, _ := payload["component_id"].(string); got != "n1" {
		t.Fatalf("payload.component_id mismatch; got %q", got)
	}
}

func TestWriteSSE_OmitsPayloadKeyWhenEmpty(t *testing.T) {
	// Bare events (Python's Done, IsAliveResponse) carry no payload.
	// The TS schema declares no payload for these, so emitting an empty
	// payload object is harmless but emitting one with stale content
	// would not be — pin the omit-on-empty contract.
	rec, flusher := newRecorder()
	writeSSE(rec, flusher, "is_alive_response", nil)

	frame := decodeSingleSSE(t, rec.Body.String())
	if _, hasPayload := frame["payload"]; hasPayload {
		t.Fatalf("nil payload must not produce a `payload` key; frame=%v", frame)
	}

	rec, flusher = newRecorder()
	writeSSE(rec, flusher, "done", map[string]any{})
	frame = decodeSingleSSE(t, rec.Body.String())
	if _, hasPayload := frame["payload"]; hasPayload {
		t.Fatalf("empty payload map must not produce a `payload` key; frame=%v", frame)
	}
}

// decodeSingleSSE reads one SSE frame the way the Studio TS parser
// does: scan line-by-line, accumulate `data:` lines, JSON-decode on
// blank-line frame boundary. Asserts exactly one frame is present.
func decodeSingleSSE(t *testing.T, body string) map[string]any {
	t.Helper()
	br := bufio.NewReader(bytes.NewBufferString(body))
	var data string
	frames := []map[string]any{}
	for {
		line, err := br.ReadString('\n')
		eof := err != nil
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if data != "" {
				var d map[string]any
				if err := json.Unmarshal([]byte(data), &d); err != nil {
					t.Fatalf("data line is not valid JSON: %v (data=%q)", err, data)
				}
				frames = append(frames, d)
				data = ""
			}
		} else if strings.HasPrefix(line, "data: ") {
			if data != "" {
				data += "\n"
			}
			data += strings.TrimPrefix(line, "data: ")
		}
		if eof {
			break
		}
	}
	if len(frames) != 1 {
		t.Fatalf("expected exactly one SSE frame; got %d in %q", len(frames), body)
	}
	return frames[0]
}
