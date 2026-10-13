package dashboard

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestBrowserLaneViews(t *testing.T) {
	stacks := func() []domain.Stack { return []domain.Stack{{Slug: "project"}} }
	unwired := New(Config{Stacks: stacks, SharedURL: func(string) string { return "" }})
	if code := getCLIRead(unwired, "/api/stacks/project/browser/walk/snapshot").Code; code != http.StatusNotImplemented {
		t.Fatalf("unwired snapshot answered %d", code)
	}
	s := New(Config{Stacks: stacks, SharedURL: func(string) string { return "" }, Browser: Browser{
		Snapshot: func(_ context.Context, slug, lane string) (any, error) {
			return map[string]string{"snapshot": slug + "/" + lane}, nil
		},
		Screenshot: func(context.Context, string, string) ([]byte, error) { return []byte("\x89PNG"), nil },
	}})
	snapshot := getCLIRead(s, "/api/stacks/project/browser/walk/snapshot")
	if snapshot.Code != http.StatusOK || !strings.Contains(snapshot.Body.String(), `"v":1`) || !strings.Contains(snapshot.Body.String(), "project/walk") {
		t.Fatalf("%d %s", snapshot.Code, snapshot.Body)
	}
	shot := getCLIRead(s, "/api/stacks/project/browser/walk/screenshot")
	if shot.Code != http.StatusOK || shot.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("%d %v", shot.Code, shot.Header())
	}
	if code := getCLIRead(s, "/api/stacks/other/browser/walk/screenshot").Code; code != http.StatusNotFound {
		t.Fatalf("unknown stack answered %d", code)
	}
}
