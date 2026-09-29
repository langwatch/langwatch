// Package webconsole serves an internal console: a Vite-built single-page app
// embedded in the Go process that owns it (ADR-160). Hashed assets cache for a
// year, index.html never caches, and any other extensionless path answers with
// index.html so the app's own router takes it. A binary built before the bundle
// answers with one plain page naming the command that builds it.
package webconsole

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"
)

const (
	indexFile = "index.html"
	// assetsDir is where Vite writes content-hashed files, whose names change
	// with their bytes and so may be cached for good.
	assetsDir        = "assets/"
	immutableCaching = "public, max-age=31536000, immutable"
)

// Console serves one bundle. The zero value is not usable; build it with New.
type Console struct {
	bundle       fs.FS
	buildCommand string
}

// New serves bundle, the root of a Vite build (the directory holding
// index.html). buildCommand is what the not-built page tells a developer to run.
func New(bundle fs.FS, buildCommand string) *Console {
	return &Console{bundle: bundle, buildCommand: buildCommand}
}

// IsBuilt reports whether the bundle carries its index.html.
func (c *Console) IsBuilt() bool {
	info, err := fs.Stat(c.bundle, indexFile)
	return err == nil && !info.IsDir()
}

// ServeHTTP answers GET and HEAD. Paths under /api are never the app's: an
// unmatched API path is a 404, not the index page.
func (c *Console) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "api" || strings.HasPrefix(name, "api/") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !c.IsBuilt() {
		c.serveNotBuilt(w)
		return
	}
	if name == "" || name == indexFile {
		c.serveFile(w, r, indexFile)
		return
	}
	if c.isFile(name) {
		c.serveFile(w, r, name)
		return
	}
	if path.Ext(name) != "" {
		http.NotFound(w, r)
		return
	}
	c.serveFile(w, r, indexFile)
}

func (c *Console) isFile(name string) bool {
	info, err := fs.Stat(c.bundle, name)
	return err == nil && !info.IsDir()
}

func (c *Console) serveFile(w http.ResponseWriter, r *http.Request, name string) {
	data, err := fs.ReadFile(c.bundle, name)
	if err != nil {
		http.Error(w, "could not read the console bundle", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", cacheControl(name))
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

// cacheControl is a file's caching: forever for a hashed asset, never for the
// index that names them, and revalidated for everything else.
func cacheControl(name string) string {
	switch {
	case name == indexFile:
		return "no-store"
	case strings.HasPrefix(name, assetsDir):
		return immutableCaching
	default:
		return "no-cache"
	}
}

func (c *Console) serveNotBuilt(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, NotBuiltMessage(c.buildCommand))
}

// NotBuiltMessage is the not-built page's whole text.
func NotBuiltMessage(buildCommand string) string {
	return fmt.Sprintf("This console is not built into this binary. Run `%s`, then rebuild the binary that serves it.\n", buildCommand)
}
