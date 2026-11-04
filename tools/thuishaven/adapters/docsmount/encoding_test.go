package docsmount

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// encodedDocs is a build with a precompressed search index, a large page with no
// siblings, and a video.
func encodedDocs(t *testing.T) (string, map[string][]byte) {
	t.Helper()
	dir := t.TempDir()
	page := []byte("<h1>Guide</h1>" + strings.Repeat("<p>reading</p>", 200))
	files := map[string][]byte{
		"index.html":           []byte("<h1>Home</h1>"),
		"guide/index.html":     page,
		"search-index.json":    []byte(`[{"slug":"guide"}]`),
		"search-index.json.br": []byte("BROTLI-BYTES"),
		"search-index.json.gz": []byte("GZIP-BYTES"),
		"media/clip.mp4":       []byte("0123456789"),
	}
	for name, body := range files {
		file := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir, files
}

func serve(t *testing.T, m *Mount, method, target string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	req.Host = appHost
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, req)
	return rec
}

func TestMountNegotiatesThePrecompressedSearchIndex(t *testing.T) {
	dir, files := encodedDocs(t)
	m := mount(t, dir, nil)
	cases := []struct {
		accept, body, encoding string
	}{
		{"gzip, deflate, br", "BROTLI-BYTES", "br"},
		{"gzip", "GZIP-BYTES", "gzip"},
		{"br;q=0, gzip;q=0.5", "GZIP-BYTES", "gzip"},
		{"*", "BROTLI-BYTES", "br"},
		{"*;q=0", string(files["search-index.json"]), ""},
		{"br;q=0, gzip;q=0", string(files["search-index.json"]), ""},
		{"", string(files["search-index.json"]), ""},
	}
	for _, tc := range cases {
		rec := serve(t, m, http.MethodGet, "/docs/search-index.json", map[string]string{"Accept-Encoding": tc.accept})
		h := rec.Header()
		if rec.Code != http.StatusOK || rec.Body.String() != tc.body || h.Get("Content-Encoding") != tc.encoding ||
			h.Get("Content-Type") != "application/json; charset=utf-8" || h.Get("Vary") != "Accept-Encoding" ||
			h.Get("Content-Length") != itoa(len(tc.body)) {
			t.Errorf("Accept-Encoding %q = %d %q encoding %q type %q vary %q length %q; want %q in %q",
				tc.accept, rec.Code, rec.Body.String(), h.Get("Content-Encoding"), h.Get("Content-Type"),
				h.Get("Vary"), h.Get("Content-Length"), tc.body, tc.encoding)
		}
	}
}

func TestMountServesRangesOfTheOriginalBytes(t *testing.T) {
	dir, files := encodedDocs(t)
	m := mount(t, dir, nil)
	rec := serve(t, m, http.MethodGet, "/docs/media/clip.mp4", map[string]string{"Range": "bytes=2-5"})
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "2345" || rec.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Errorf("video range = %d %q %q, want 206 \"2345\" bytes 2-5/10", rec.Code, rec.Body.String(), rec.Header().Get("Content-Range"))
	}
	if rec.Header().Get("Vary") != "" || rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Errorf("video vary %q accept-ranges %q, want none and bytes", rec.Header().Get("Vary"), rec.Header().Get("Accept-Ranges"))
	}
	ranged := serve(t, m, http.MethodGet, "/docs/search-index.json", map[string]string{"Range": "bytes=0-4", "Accept-Encoding": "br, gzip"})
	if ranged.Code != http.StatusPartialContent || ranged.Body.String() != string(files["search-index.json"][:5]) || ranged.Header().Get("Content-Encoding") != "" {
		t.Errorf("ranged index = %d %q encoding %q, want the original's first five bytes", ranged.Code, ranged.Body.String(), ranged.Header().Get("Content-Encoding"))
	}
	head := serve(t, m, http.MethodHead, "/docs/media/clip.mp4", nil)
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Length") != "10" {
		t.Errorf("HEAD video = %d with %d bytes, length %q; want 200, none, 10", head.Code, head.Body.Len(), head.Header().Get("Content-Length"))
	}
}

func TestMountAnswersConditionalRequests(t *testing.T) {
	dir, _ := encodedDocs(t)
	m := mount(t, dir, nil)
	later := time.Now().Add(time.Hour).UTC().Format(http.TimeFormat)
	for _, accept := range []string{"", "gzip"} {
		rec := serve(t, m, http.MethodGet, "/docs/guide", map[string]string{"If-Modified-Since": later, "Accept-Encoding": accept})
		if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
			t.Errorf("conditional GET (accept %q) = %d with %d bytes, want 304", accept, rec.Code, rec.Body.Len())
		}
	}
}

func TestMountGzipsLargeTextWithNoPrecompressedSibling(t *testing.T) {
	dir, files := encodedDocs(t)
	m := mount(t, dir, nil)
	rec := serve(t, m, http.MethodGet, "/docs/guide", map[string]string{"Accept-Encoding": "gzip"})
	if rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Content-Length") != "" || rec.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("live gzip headers = %v", rec.Header())
	}
	zr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := io.ReadAll(zr)
	if !bytes.Equal(plain, files["guide/index.html"]) {
		t.Error("the gzipped page does not decompress to the page")
	}
	refused := serve(t, m, http.MethodGet, "/docs/guide", map[string]string{"Accept-Encoding": "gzip;q=0"})
	if refused.Header().Get("Content-Encoding") != "" || refused.Body.String() != string(files["guide/index.html"]) {
		t.Errorf("gzip;q=0 = encoding %q, want the identity", refused.Header().Get("Content-Encoding"))
	}
	small := serve(t, m, http.MethodGet, "/docs/", map[string]string{"Accept-Encoding": "gzip"})
	if small.Header().Get("Content-Encoding") != "" {
		t.Error("a page under the threshold was compressed")
	}
}

func itoa(n int) string { return strconv.Itoa(n) }
