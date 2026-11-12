// Package docsmount serves a built docs site (apps/docs, built with --base-path)
// under its path prefix, natively from disk: the static-host contract of the
// docs preview server. On the app hostname every other path is handed to the
// app itself, so app.<slug>.langwatch.localhost/docs is a real address.
package docsmount

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Options is one mount: the built tree, its prefix and, on the app hostname,
// the app that answers every path outside the prefix.
type Options struct {
	// Dir is the build output (index.html, 404.html, redirects.json, ...).
	Dir string
	// BasePath is the prefix the build was made for, such as "/docs".
	BasePath string
	// Upstream is the app's own listener; nil when the docs run alone.
	Upstream *url.URL
	// AppHost is the hostname whose other paths go to Upstream; any other host
	// (docs.<slug>, loopback) sends its root to the docs instead.
	AppHost string
}

// Mount is the HTTP handler for one Options.
type Mount struct {
	opts      Options
	files     fs.FS
	proxy     *httputil.ReverseProxy
	redirects redirectCache
}

// New validates opts and returns the mount.
func New(opts Options) (*Mount, error) {
	if !validBasePath(opts.BasePath) {
		return nil, fmt.Errorf("docs mount: %q is not a base path such as /docs", opts.BasePath)
	}
	m := &Mount{opts: opts, files: os.DirFS(opts.Dir), redirects: redirectCache{file: filepath.Join(opts.Dir, "redirects.json")}}
	if opts.Upstream != nil {
		m.proxy = appProxy(opts.Upstream)
	}
	return m, nil
}

// validBasePath accepts "/segment[/segment]" with no dot segments, the rule the
// docs build applies to --base-path.
func validBasePath(base string) bool {
	if base == "" || base[0] != '/' || strings.HasSuffix(base, "/") {
		return false
	}
	for segment := range strings.SplitSeq(base[1:], "/") {
		if !validSegment(segment) {
			return false
		}
	}
	return true
}

// unreserved are the characters a base path segment may hold (RFC 3986).
const unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~-"

// validSegment is one non-empty, non-dot path segment of unreserved characters.
func validSegment(segment string) bool {
	return segment != "" && segment != "." && segment != ".." && strings.Trim(segment, unreserved) == ""
}

func (m *Mount) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	base := m.opts.BasePath
	p := r.URL.Path
	switch {
	case p == base:
		redirect(w, r, movedTo(base+"/"+query(r.URL.RawQuery)))
	case strings.HasPrefix(p, base+"/"):
		m.serveDocs(w, r, strings.TrimPrefix(p, base))
	case m.proxy != nil && hostname(r.Host) == m.opts.AppHost:
		m.proxy.ServeHTTP(w, r)
	case p == "/":
		redirect(w, r, redirectTo{target: base + "/" + query(r.URL.RawQuery), status: http.StatusFound})
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = fmt.Fprintf(w, "Not found: the documentation is served under %s/\n", base)
	}
}

// serveDocs answers a site path (the request path with the prefix removed).
func (m *Mount) serveDocs(w http.ResponseWriter, r *http.Request, sitePath string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "the documentation is read-only", http.StatusMethodNotAllowed)
		return
	}
	// A local build is never a second canonical; the pages name production.
	w.Header().Set("X-Robots-Tag", "noindex")
	if !m.isBuilt() {
		w.Header().Set("Retry-After", "5")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = fmt.Fprint(w, buildingPage)
		return
	}
	if target, ok := m.redirectFor(sitePath, r.URL.RawQuery); ok {
		redirect(w, r, movedTo(target))
		return
	}
	name, ok := m.resolve(sitePath)
	if !ok {
		m.notFound(w, r, sitePath)
		return
	}
	m.serveFile(w, r, servedFile{name: name, status: http.StatusOK})
}

// resolve maps a site path to a file in the build: `/x` and `/x/` to
// x/index.html (or x.html), `/` to index.html, a path with an extension to itself.
func (m *Mount) resolve(sitePath string) (string, bool) {
	// A dot segment names a path the browser would have resolved first; never guess.
	for segment := range strings.SplitSeq(sitePath, "/") {
		if segment == "." || segment == ".." {
			return "", false
		}
	}
	rel := strings.TrimPrefix(path.Clean(sitePath), "/")
	var candidates []string
	switch {
	case rel == "":
		candidates = []string{"index.html"}
	case strings.HasSuffix(sitePath, "/") || path.Ext(rel) == "":
		candidates = []string{rel + "/index.html", rel + ".html"}
	default:
		candidates = []string{rel}
	}
	for _, name := range candidates {
		if info, err := fs.Stat(m.files, name); err == nil && info.Mode().IsRegular() {
			return name, true
		}
	}
	return "", false
}

// notFound answers a page miss with the site's 404 page and a file miss with
// plain text: an index or error page in place of an asset hides a real miss.
func (m *Mount) notFound(w http.ResponseWriter, r *http.Request, sitePath string) {
	if path.Ext(sitePath) == "" || strings.HasSuffix(sitePath, "/") {
		if _, err := fs.Stat(m.files, "404.html"); err == nil {
			m.serveFile(w, r, servedFile{name: "404.html", status: http.StatusNotFound})
			return
		}
	}
	http.NotFound(w, r)
}

// servedFile is a file from the build and the status it answers with.
type servedFile struct {
	name   string
	status int
}

// serveFile answers with a file. A page or asset streams from disk with Range,
// HEAD and conditional requests (http.ServeContent) and, for text, the best
// encoding the reader accepts; the small 404 page is written whole.
func (m *Mount) serveFile(w http.ResponseWriter, r *http.Request, file servedFile) {
	h := w.Header()
	h.Set("Content-Type", contentType(file.name))
	h.Set("Cache-Control", cacheControl(file.name))
	if compressible(file.name) {
		h.Add("Vary", "Accept-Encoding")
	}
	if file.status != http.StatusOK {
		m.serveWhole(w, r, file)
		return
	}
	name, coding := m.variant(r, file.name)
	f, err := m.files.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	content, seekable := f.(io.ReadSeeker)
	if err != nil || !seekable {
		http.NotFound(w, r)
		return
	}
	if coding != "" {
		// ServeContent leaves the length out for an encoded body; a precompressed file knows it.
		h.Set("Content-Encoding", coding)
		h.Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	} else if liveGzip(r, file.name, info.Size()) {
		serveGzip(w, r, f)
		return
	}
	http.ServeContent(w, r, file.name, info.ModTime(), content)
}

// serveWhole writes a small file in one piece with file.status.
func (m *Mount) serveWhole(w http.ResponseWriter, r *http.Request, file servedFile) {
	body, err := fs.ReadFile(m.files, file.name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(file.status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

func (m *Mount) isBuilt() bool {
	_, err := fs.Stat(m.files, "index.html")
	return err == nil
}

// contentType names the docs' own text formats: the page exports are Markdown.
func contentType(name string) string {
	switch path.Ext(name) {
	case ".md", ".claude", ".agent":
		return "text/markdown; charset=utf-8"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".xml":
		return "application/xml; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".html":
		return "text/html; charset=utf-8"
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// cacheControl: Vite's hashed assets never change; everything else revalidates,
// so a rebuild shows at once.
func cacheControl(name string) string {
	if strings.HasPrefix(name, "assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

// redirectFor is the docs.json redirect for a site path, prefixed with the
// mount; the incoming query survives unless the destination sets the key.
func (m *Mount) redirectFor(sitePath, rawQuery string) (string, bool) {
	destination, ok := m.redirects.lookup(strings.TrimSuffix(sitePath, "/"))
	if !ok {
		return "", false
	}
	target, err := url.Parse(destination)
	if err != nil {
		return "", false
	}
	incoming, _ := url.ParseQuery(rawQuery)
	values := target.Query()
	for key, list := range incoming {
		if _, set := values[key]; !set {
			values[key] = list
		}
	}
	target.RawQuery = values.Encode()
	if target.IsAbs() {
		return target.String(), true
	}
	if strings.HasPrefix(target.Path, "/") && !strings.HasPrefix(target.Path, "//") {
		target.Path = m.opts.BasePath + target.Path
	}
	return target.String(), true
}

// redirectCache reads redirects.json again only when a rebuild replaced it.
type redirectCache struct {
	file    string
	mu      sync.Mutex
	modTime time.Time
	table   map[string]string
}

func (c *redirectCache) lookup(source string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	info, err := os.Stat(c.file)
	if err != nil {
		return "", false
	}
	if !info.ModTime().Equal(c.modTime) || c.table == nil {
		table := map[string]string{}
		data, err := os.ReadFile(c.file)
		if err == nil && json.Unmarshal(data, &table) == nil {
			c.table, c.modTime = table, info.ModTime()
		}
	}
	destination, ok := c.table[source]
	return destination, ok
}

// appProxy hands a request to the app unchanged: Host and the proxy's
// X-Forwarded-* stay as the browser's proxy sent them; websockets and streams pass.
func appProxy(upstream *url.URL) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstream)
			pr.Out.Host = pr.In.Host
			for _, header := range []string{"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto"} {
				if values, ok := pr.In.Header[header]; ok {
					pr.Out.Header[header] = values
				}
			}
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			if errors.Is(err, http.ErrAbortHandler) {
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, appWaitingPage, html.EscapeString(upstream.Host))
		},
	}
}

func hostname(hostport string) string {
	if h, _, ok := strings.Cut(hostport, ":"); ok {
		return strings.ToLower(h)
	}
	return strings.ToLower(hostport)
}

func query(raw string) string {
	if raw == "" {
		return ""
	}
	return "?" + raw
}

// redirectTo is a Location and its status.
type redirectTo struct {
	target string
	status int
}

func movedTo(target string) redirectTo {
	return redirectTo{target: target, status: http.StatusMovedPermanently}
}

// redirect answers with to. Every target is the mount's own prefix or a docs.json
// destination; the request contributes only its query string.
func redirect(w http.ResponseWriter, r *http.Request, to redirectTo) {
	w.Header().Set("Cache-Control", "no-cache")
	http.Redirect(w, r, to.target, to.status)
}

const buildingPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Building the docs</title></head>` +
	`<body style="font:15px/1.5 system-ui,sans-serif;margin:3rem"><h1>Building the documentation</h1>` +
	`<p>The docs lane is building the site; this page reloads when it is ready. <code>haven logs docs -f</code> shows progress.</p></body></html>`

const appWaitingPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Waiting for the app</title></head>` +
	`<body style="font:15px/1.5 system-ui,sans-serif;margin:3rem"><h1>The app is not answering yet</h1>` +
	`<p>The docs at /docs are up; the app on %s is starting. This page reloads.</p></body></html>`
