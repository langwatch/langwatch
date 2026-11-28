package pi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

type bufferWriteCloser struct{ bytes.Buffer }

func (*bufferWriteCloser) Close() error { return nil }

// The turn's images ride the wrapper's turn line under the field names
// services/langyworker/src/protocol.ts parses: images[].name, mediaType, data.
//
// @scenario "A turn's images reach pi as image input"
func TestAgent_Post_WritesImagesOnTheTurnLine(t *testing.T) {
	stdin := &bufferWriteCloser{}
	agent := NewAgent(time.Second)
	agent.stdin = stdin
	agent.reader = newReader(io.NopCloser(strings.NewReader("")))

	images := []domain.TurnImage{{Name: "pasted-7bd830.png", MediaType: "image/png", Data: "iVBORw0KGgo="}}
	if err := agent.Post(context.Background(), "sess", app.Turn{TurnID: "turn-img", Prompt: "what is this?", Images: images}); err != nil {
		t.Fatalf("Post: %v", err)
	}

	var line struct {
		Type   string           `json:"type"`
		TurnID string           `json:"turnId"`
		Images []map[string]any `json:"images"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(stdin.Bytes()), &line); err != nil {
		t.Fatalf("turn line is not one JSON object: %v (%q)", err, stdin.String())
	}
	if line.Type != "turn" || line.TurnID != "turn-img" {
		t.Fatalf("line = %+v, want the turn command", line)
	}
	if len(line.Images) != 1 {
		t.Fatalf("images = %v, want one", line.Images)
	}
	want := map[string]any{"name": "pasted-7bd830.png", "mediaType": "image/png", "data": "iVBORw0KGgo="}
	for k, v := range want {
		if line.Images[0][k] != v {
			t.Errorf("images[0].%s = %v, want %v", k, line.Images[0][k], v)
		}
	}
}

func TestAgent_Post_OmitsImagesWhenTheTurnHasNone(t *testing.T) {
	stdin := &bufferWriteCloser{}
	agent := NewAgent(time.Second)
	agent.stdin = stdin
	agent.reader = newReader(io.NopCloser(strings.NewReader("")))

	if err := agent.Post(context.Background(), "sess", app.Turn{TurnID: "turn-text", Prompt: "hi"}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	if strings.Contains(stdin.String(), `"images"`) {
		t.Fatalf("a text-only turn line carried an images field: %q", stdin.String())
	}
}
