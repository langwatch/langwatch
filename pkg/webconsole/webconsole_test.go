package webconsole

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func builtBundle() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><div id=root></div>")},
		"assets/index-Ab12.js": {Data: []byte("console.log(1)")},
		"favicon.svg":          {Data: []byte("<svg/>")},
	}
}

func get(t *testing.T, c *Console, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestConsoleServesTheBundle(t *testing.T) {
	c := New(builtBundle(), "make haven-web")
	cases := []struct {
		target, cache, bodyHas string
		status                 int
	}{
		{"/", "no-store", "id=root", http.StatusOK},
		{"/index.html", "no-store", "id=root", http.StatusOK},
		{"/assets/index-Ab12.js", immutableCaching, "console.log", http.StatusOK},
		{"/favicon.svg", "no-cache", "<svg/>", http.StatusOK},
		{"/stacks/feat-x", "no-store", "id=root", http.StatusOK},
		{"/logs/feat-x/api", "no-store", "id=root", http.StatusOK},
	}
	for _, tc := range cases {
		rec := get(t, c, http.MethodGet, tc.target)
		if rec.Code != tc.status || rec.Header().Get("Cache-Control") != tc.cache || !strings.Contains(rec.Body.String(), tc.bodyHas) {
			t.Errorf("GET %s = %d cache %q body %q; want %d cache %q containing %q",
				tc.target, rec.Code, rec.Header().Get("Cache-Control"), rec.Body.String(), tc.status, tc.cache, tc.bodyHas)
		}
	}
}

func TestConsoleNeverAnswersAMissingFileOrAnAPIPathWithTheIndex(t *testing.T) {
	c := New(builtBundle(), "make haven-web")
	for _, target := range []string{"/assets/gone-Zz99.js", "/api", "/api/unknown", "/robots.txt"} {
		if rec := get(t, c, http.MethodGet, target); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 (an index page there hides a real miss)", target, rec.Code)
		}
	}
}

func TestConsoleRefusesWrites(t *testing.T) {
	c := New(builtBundle(), "make haven-web")
	if rec := get(t, c, http.MethodPost, "/"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST / = %d, want 405", rec.Code)
	}
	if rec := get(t, c, http.MethodHead, "/"); rec.Code != http.StatusOK {
		t.Errorf("HEAD / = %d, want 200", rec.Code)
	}
}

func TestConsoleWithoutABundleNamesTheBuildCommand(t *testing.T) {
	c := New(fstest.MapFS{".gitkeep": {}}, "make haven-web")
	if c.IsBuilt() {
		t.Fatal("a bundle with no index.html reported built")
	}
	for _, target := range []string{"/", "/stacks/feat-x", "/assets/index-Ab12.js"} {
		rec := get(t, c, http.MethodGet, target)
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "make haven-web") {
			t.Errorf("GET %s = %d %q, want 503 naming make haven-web", target, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("GET %s: the not-built page must not be cached, got %q", target, rec.Header().Get("Cache-Control"))
		}
	}
}

func TestNotBuiltPageEscapesBuildInstructionsAndEmbedsCanonicalIcon(t *testing.T) {
	svg, err := os.ReadFile("../../packages/design-system-internal/assets/haven.svg")
	if err != nil {
		t.Fatal(err)
	}
	encoded := strings.TrimPrefix(havenIconDataURL, "data:image/svg+xml;base64,")
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.Equal(decoded, svg) {
		t.Fatal("Go favicon differs from the canonical SVG; run pnpm --filter @langwatch/design-system-internal generate:haven-icon")
	}
	page := NotBuiltPage("build <script>alert(1)</script>")
	if strings.Contains(page, "<script>") || !strings.Contains(page, "&lt;script&gt;") {
		t.Fatal("build instructions must be escaped in HTML")
	}
	if !strings.Contains(page, `rel="icon" type="image/svg+xml" href="`+havenIconDataURL+`"`) {
		t.Fatal("the fallback page must include the shared favicon")
	}
}

func TestNotBuiltPageHasHTMLContentTypeAndNoHeadBody(t *testing.T) {
	c := New(fstest.MapFS{}, "make haven-web")
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		rec := get(t, c, method, "/")
		if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: got status %d, content type %q", method, rec.Code, rec.Header().Get("Content-Type"))
		}
		if method == http.MethodHead && rec.Body.Len() != 0 {
			t.Fatal("HEAD must not send an HTML body")
		}
		if method == http.MethodGet && !strings.Contains(rec.Body.String(), `rel="icon"`) {
			t.Fatal("GET must serve the HTML fallback with its favicon")
		}
	}
}
