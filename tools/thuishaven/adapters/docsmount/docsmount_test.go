package docsmount

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const appHost = "app.feat-x.langwatch.localhost"

func builtDocs(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"index.html":              "<h1>Home</h1>",
		"introduction/index.html": "<h1>Introduction</h1>",
		"guide/index.html":        "<h1>Guide</h1>",
		"api/index.html":          "<h1>API index slug</h1>",
		"api/index.md":            "# API",
		"404.html":                "<h1>Missing page</h1>",
		"guide.md":                "# Guide",
		"llms.txt":                "# LangWatch",
		"sitemap.xml":             "<urlset/>",
		"sw.js":                   "self.addEventListener('fetch', () => {})",
		"assets/entry-Ab12.js":    "console.log(1)",
		"redirects.json":          `{"/old":"/guide?tab=py#install","/away":"https://langwatch.ai/x"}`,
	}
	for name, body := range files {
		file := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func mount(t *testing.T, dir string, upstream *url.URL) *Mount {
	t.Helper()
	m, err := New(Options{Dir: dir, BasePath: "/docs", Upstream: upstream, AppHost: appHost})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func request(m http.Handler, method, host, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, nil)
	req.Host = host
	m.ServeHTTP(rec, req)
	return rec
}

func TestMountServesTheStaticHostContractUnderTheBasePath(t *testing.T) {
	m := mount(t, builtDocs(t), nil)
	cases := []struct {
		target, body, contentType, cache string
		status                           int
	}{
		{"/docs/", "Home", "text/html; charset=utf-8", "no-cache", 200},
		{"/docs/introduction", "Introduction", "text/html; charset=utf-8", "no-cache", 200},
		{"/docs/guide/", "Guide", "text/html; charset=utf-8", "no-cache", 200},
		{"/docs/api/index", "API index slug", "text/html; charset=utf-8", "no-cache", 200},
		{"/docs/guide.md", "# Guide", "text/markdown; charset=utf-8", "no-cache", 200},
		{"/docs/llms.txt", "LangWatch", "text/plain; charset=utf-8", "no-cache", 200},
		{"/docs/sitemap.xml", "urlset", "application/xml; charset=utf-8", "no-cache", 200},
		{"/docs/sw.js", "fetch", "text/javascript; charset=utf-8", "no-cache", 200},
		{"/docs/assets/entry-Ab12.js", "console", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable", 200},
		{"/docs/no-such-page", "Missing page", "text/html; charset=utf-8", "no-cache", 404},
	}
	for _, tc := range cases {
		rec := request(m, http.MethodGet, "docs.feat-x.langwatch.localhost", tc.target)
		if rec.Code != tc.status || !strings.Contains(rec.Body.String(), tc.body) ||
			rec.Header().Get("Content-Type") != tc.contentType || rec.Header().Get("Cache-Control") != tc.cache {
			t.Errorf("GET %s = %d %q type %q cache %q; want %d containing %q, %q, %q", tc.target, rec.Code, rec.Body.String(),
				rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"), tc.status, tc.body, tc.contentType, tc.cache)
		}
		if rec.Header().Get("X-Robots-Tag") != "noindex" {
			t.Errorf("GET %s: a local mount must not be indexed", tc.target)
		}
	}
}

func TestMountNeverAnswersAMissingFileWithAPage(t *testing.T) {
	m := mount(t, builtDocs(t), nil)
	for _, target := range []string{"/docs/assets/gone-Zz99.js", "/docs/missing.md", "/docs/../index.html", "/docs/%2e%2e/index.html"} {
		rec := request(m, http.MethodGet, appHost, target)
		if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "Home") {
			t.Errorf("GET %s = %d %q, want a plain 404", target, rec.Code, rec.Body.String())
		}
	}
}

func TestMountRedirectsUnderThePrefixAndKeepsTheQuery(t *testing.T) {
	m := mount(t, builtDocs(t), nil)
	cases := map[string]string{
		"/docs":               "/docs/",
		"/docs?q=1":           "/docs/?q=1",
		"/docs/old":           "/docs/guide?tab=py#install",
		"/docs/old/?from=nav": "/docs/guide?from=nav&tab=py#install",
		"/docs/old?tab=ts":    "/docs/guide?tab=py#install",
		"/docs/away":          "https://langwatch.ai/x",
	}
	for target, want := range cases {
		rec := request(m, http.MethodGet, appHost, target)
		if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != want {
			t.Errorf("GET %s = %d Location %q, want 301 %q", target, rec.Code, rec.Header().Get("Location"), want)
		}
	}
}

func TestMountAloneSendsTheRootToTheDocs(t *testing.T) {
	m := mount(t, builtDocs(t), nil)
	rec := request(m, http.MethodGet, appHost, "/")
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/docs/" {
		t.Errorf("GET / = %d %q, want 302 /docs/", rec.Code, rec.Header().Get("Location"))
	}
	if rec := request(m, http.MethodGet, appHost, "/api/health"); rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/health alone = %d, want 404", rec.Code)
	}
}

func TestMountHandsEveryOtherAppPathToTheAppUnchanged(t *testing.T) {
	var seen *http.Request
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "app:"+r.URL.Path)
	}))
	defer app.Close()
	upstream, _ := url.Parse(app.URL)
	front := httptest.NewServer(mount(t, builtDocs(t), upstream))
	defer front.Close()

	req, _ := http.NewRequest(http.MethodPost, front.URL+"/api/trpc/x?batch=1", strings.NewReader("{}"))
	req.Host = appHost
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if string(body) != "app:/api/trpc/x" || seen.Host != appHost || seen.Header.Get("X-Forwarded-Proto") != "https" || seen.URL.RawQuery != "batch=1" {
		t.Fatalf("proxied %q host %q proto %q query %q", body, seen.Host, seen.Header.Get("X-Forwarded-Proto"), seen.URL.RawQuery)
	}

	docs, _ := http.NewRequest(http.MethodGet, front.URL+"/docs/introduction", nil)
	docs.Host = appHost
	res, err = http.DefaultClient.Do(docs)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	_ = res.Body.Close()
	if !strings.Contains(string(body), "Introduction") {
		t.Errorf("/docs/introduction on the app host = %q, want the docs page", body)
	}

	// docs.<slug> is the docs alone: its root goes to the docs, never to the app.
	other := request(mount(t, builtDocs(t), upstream), http.MethodGet, "docs.feat-x.langwatch.localhost", "/")
	if other.Code != http.StatusFound || other.Header().Get("Location") != "/docs/" {
		t.Errorf("GET / on docs host = %d %q, want 302 /docs/", other.Code, other.Header().Get("Location"))
	}
}

func TestMountPassesWebsocketUpgradesToTheApp(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = http.ReadRequest(bufio.NewReader(conn))
		_, _ = io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhmr")
	}()
	upstream, _ := url.Parse("http://" + ln.Addr().String())
	front := httptest.NewServer(mount(t, builtDocs(t), upstream))
	defer front.Close()

	conn, err := net.Dial("tcp", strings.TrimPrefix(front.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = io.WriteString(conn, "GET /@vite/hmr HTTP/1.1\r\nHost: "+appHost+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
	reader := bufio.NewReader(conn)
	res, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("upgrade = %d, want 101", res.StatusCode)
	}
	frame := make([]byte, 3)
	if _, err := io.ReadFull(reader, frame); err != nil || string(frame) != "hmr" {
		t.Fatalf("upgraded stream = %q %v", frame, err)
	}
}

func TestMountAnswersWhileTheFirstBuildRuns(t *testing.T) {
	m := mount(t, t.TempDir(), nil)
	rec := request(m, http.MethodGet, appHost, "/docs/introduction")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "haven logs docs") {
		t.Errorf("unbuilt GET = %d %q, want 503 naming the log", rec.Code, rec.Body.String())
	}
}

func TestMountIsReadOnly(t *testing.T) {
	m := mount(t, builtDocs(t), nil)
	if rec := request(m, http.MethodPost, appHost, "/docs/guide"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want 405", rec.Code)
	}
	if rec := request(m, http.MethodHead, appHost, "/docs/guide"); rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Errorf("HEAD = %d with %d bytes, want 200 and no body", rec.Code, rec.Body.Len())
	}
}

func TestNewRefusesABasePathOutsideAPlainPrefix(t *testing.T) {
	for _, base := range []string{"", "/", "docs", "/docs/", "/..", "/docs/../x", "/./docs", "//docs", "/do cs", "/docs?x"} {
		if _, err := New(Options{Dir: t.TempDir(), BasePath: base}); err == nil {
			t.Errorf("New(%q) accepted a base path the docs build refuses", base)
		}
	}
}

// @scenario "The docs site is built and mounted at /docs on the app"
func TestMountKeepsTheAppUpWhileTheFirstBuildRuns(t *testing.T) {
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "app:"+r.URL.Path)
	}))
	defer app.Close()
	upstream, _ := url.Parse(app.URL)
	front := httptest.NewServer(mount(t, t.TempDir(), upstream))
	defer front.Close()
	for target, want := range map[string]struct {
		status int
		body   string
	}{
		"/api/health":        {http.StatusOK, "app:/api/health"},
		"/":                  {http.StatusOK, "app:/"},
		"/docs/introduction": {http.StatusServiceUnavailable, "Building the documentation"},
	} {
		req, _ := http.NewRequest(http.MethodGet, front.URL+target, nil)
		req.Host = appHost
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if res.StatusCode != want.status || !strings.Contains(string(body), want.body) {
			t.Errorf("GET %s during the first build = %d %q, want %d containing %q", target, res.StatusCode, body, want.status, want.body)
		}
	}
}

// @scenario "The docs site is built and mounted at /docs on the app"
func TestMountKeepsTheDocsUpWhenTheAppStops(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	upstream, _ := url.Parse("http://" + ln.Addr().String())
	_ = ln.Close() // nothing listens there any more: the app has stopped
	m := mount(t, builtDocs(t), upstream)
	if rec := request(m, http.MethodGet, appHost, "/docs/introduction"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Introduction") {
		t.Errorf("docs with the app stopped = %d %q, want the page", rec.Code, rec.Body.String())
	}
	rec := request(m, http.MethodGet, appHost, "/api/health")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "The app is not answering yet") {
		t.Errorf("app path with the app stopped = %d %q, want the mount's waiting page", rec.Code, rec.Body.String())
	}
}
