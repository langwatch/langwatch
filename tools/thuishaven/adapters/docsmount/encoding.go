package docsmount

import (
	"compress/gzip"
	"io"
	"io/fs"
	"net/http"

	"strconv"
	"strings"
	"time"
)

// precompressed are the siblings a build may emit beside a text file, best first.
var precompressed = []struct{ coding, ext string }{{"br", ".br"}, {"gzip", ".gz"}}

// liveGzipMin is the size below which compressing on the fly is not worth it.
const liveGzipMin = 1024

// compressible: the docs' text formats; media and fonts are compressed already.
func compressible(name string) bool {
	t := contentType(name)
	return strings.HasPrefix(t, "text/") || strings.HasPrefix(t, "application/json") ||
		strings.HasPrefix(t, "application/xml") || strings.HasPrefix(t, "image/svg+xml")
}

// variant is the file to send for name and its Content-Encoding: a precompressed
// sibling the reader accepts, or name itself. A Range request always gets the
// original bytes, so offsets mean what a seeking reader expects.
func (m *Mount) variant(r *http.Request, name string) (string, string) {
	if r.Header.Get("Range") != "" || !compressible(name) {
		return name, ""
	}
	accept := r.Header.Get("Accept-Encoding")
	for _, p := range precompressed {
		if !acceptsCoding(accept, p.coding) {
			continue
		}
		if info, err := fs.Stat(m.files, name+p.ext); err == nil && info.Mode().IsRegular() {
			return name + p.ext, p.coding
		}
	}
	return name, ""
}

// liveGzip: text with no precompressed sibling, big enough, whole, and accepted.
func liveGzip(r *http.Request, name string, size int64) bool {
	return compressible(name) && size >= liveGzipMin && r.Header.Get("Range") == "" &&
		acceptsCoding(r.Header.Get("Accept-Encoding"), "gzip")
}

// serveGzip streams file gzipped, answering If-Modified-Since; the length is
// unknown up front, so the response is chunked.
func serveGzip(w http.ResponseWriter, r *http.Request, file fs.File) {
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	modTime := info.ModTime()
	h := w.Header()
	h.Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
	if since, err := http.ParseTime(r.Header.Get("If-Modified-Since")); err == nil && !modTime.Truncate(time.Second).After(since) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Encoding", "gzip")
	h.Del("Content-Length")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	zw := gzip.NewWriter(w)
	_, _ = io.Copy(zw, file)
	_ = zw.Close()
}

// acceptsCoding reads Accept-Encoding: the coding's own weight decides, else
// `*`'s; q=0 refuses. An absent header accepts nothing but the identity.
func acceptsCoding(header, coding string) bool {
	own, star := -1.0, -1.0
	for part := range strings.SplitSeq(header, ",") {
		name, params, _ := strings.Cut(part, ";")
		switch strings.ToLower(strings.TrimSpace(name)) {
		case coding:
			own = weight(params)
		case "*":
			star = weight(params)
		}
	}
	if own >= 0 {
		return own > 0
	}
	return star > 0
}

// weight is a coding's q parameter, 1 when absent or unreadable.
func weight(params string) float64 {
	for param := range strings.SplitSeq(params, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
		if ok && strings.EqualFold(key, "q") {
			if q, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				return q
			}
		}
	}
	return 1
}
