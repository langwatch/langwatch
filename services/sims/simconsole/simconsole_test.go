package simconsole

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

func TestPageServesItsOwnIndexBesideTheSharedAssets(t *testing.T) {
	dist := fstest.MapFS{
		"llm/index.html":  {Data: []byte("llm page")},
		"mail/index.html": {Data: []byte("mail page")},
		"assets/llm.js":   {Data: []byte("llm script")},
	}
	console := webconsole.New(page{dist: dist, index: "llm/index.html"}, BuildCommand)
	for path, want := range map[string]string{"/": "llm page", "/calls/7": "llm page", "/assets/llm.js": "llm script"} {
		rec := httptest.NewRecorder()
		console.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("GET %s = %d %q, want 200 %q", path, rec.Code, rec.Body.String(), want)
		}
	}
}

func TestPageWithoutABuiltIndexIsNotBuilt(t *testing.T) {
	if _, err := fs.Stat(Page("no-such-sim"), "index.html"); err == nil {
		t.Fatal("a page that was never built has an index.html")
	}
	if webconsole.New(Page("no-such-sim"), BuildCommand).IsBuilt() {
		t.Fatal("a page that was never built reports itself built")
	}
}
