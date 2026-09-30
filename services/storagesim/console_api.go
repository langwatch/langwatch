package storagesim

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// requestLogSize bounds how many recent S3 requests the console remembers.
const requestLogSize = 500

// requestEntry is one S3 request as the console lists it.
type requestEntry struct {
	Method string    `json:"method"`
	Bucket string    `json:"bucket"`
	Key    string    `json:"key"`
	Status int       `json:"status"`
	At     time.Time `json:"at"`
}

// requestLog keeps the newest requestLogSize entries.
type requestLog struct {
	mu      sync.Mutex
	entries []requestEntry
}

func newRequestLog() *requestLog { return &requestLog{} }

func (l *requestLog) add(e requestEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) == requestLogSize {
		l.entries = l.entries[1:]
	}
	l.entries = append(l.entries, e)
}

// recent answers the entries newest first.
func (l *requestLog) recent() []requestEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := slices.Clone(l.entries)
	slices.Reverse(out)
	return out
}

// statusRecorder remembers the status a handler wrote.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// objectInfo is one stored object as the console lists it.
type objectInfo struct {
	Bucket       string    `json:"bucket"`
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	ContentType  string    `json:"contentType"`
	ETag         string    `json:"etag"`
	LastModified time.Time `json:"lastModified"`
}

type bucketInfo struct {
	Name    string `json:"name"`
	Objects int    `json:"objects"`
	Size    int64  `json:"size"`
}

// objectDetail adds the headers a GET on the object answers with.
type objectDetail struct {
	objectInfo
	Headers map[string]string `json:"headers"`
}

func (s *Server) consoleAPI(urlPath string) (http.HandlerFunc, bool) {
	switch urlPath {
	case "/_sim/api/buckets":
		return s.handleBuckets, true
	case "/_sim/api/objects":
		return s.handleObjects, true
	case "/_sim/api/object":
		return s.handleObject, true
	case "/_sim/api/object/raw":
		return s.handleRaw, true
	case "/_sim/api/requests":
		return s.handleRequests, true
	}
	return nil, false
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// listObjects reads every stored object's sidecar; a sidecar without its bytes is skipped.
func (s *Server) listObjects() []objectInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	sidecars, _ := filepath.Glob(filepath.Join(s.cfg.DataDir, "*.json"))
	out := []objectInfo{}
	for _, sidecar := range sidecars {
		if info, ok := readObject(sidecar); ok {
			out = append(out, info)
		}
	}
	slices.SortFunc(out, func(a, b objectInfo) int {
		return strings.Compare(a.Bucket+"/"+a.Key, b.Bucket+"/"+b.Key)
	})
	return out
}

func readObject(sidecar string) (objectInfo, bool) {
	m, ok := readMeta(sidecar)
	if !ok {
		return objectInfo{}, false
	}
	stat, err := os.Lstat(strings.TrimSuffix(sidecar, ".json"))
	if err != nil || !stat.Mode().IsRegular() {
		return objectInfo{}, false
	}
	return objectInfo{Bucket: m.Bucket, Key: m.Key, Size: stat.Size(), ContentType: m.ContentType, ETag: m.ETag, LastModified: stat.ModTime().UTC()}, true
}

func (s *Server) handleBuckets(w http.ResponseWriter, _ *http.Request) {
	buckets := []bucketInfo{}
	for _, o := range s.listObjects() {
		if n := len(buckets); n > 0 && buckets[n-1].Name == o.Bucket {
			buckets[n-1].Objects++
			buckets[n-1].Size += o.Size
			continue
		}
		buckets = append(buckets, bucketInfo{Name: o.Bucket, Objects: 1, Size: o.Size})
	}
	writeJSON(w, http.StatusOK, map[string]any{"buckets": buckets})
}

// handleObjects lists one bucket's objects, or every bucket's without ?bucket=.
func (s *Server) handleObjects(w http.ResponseWriter, r *http.Request) {
	bucket := r.URL.Query().Get("bucket")
	objects := []objectInfo{}
	for _, o := range s.listObjects() {
		if bucket == "" || o.Bucket == bucket {
			objects = append(objects, o)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"objects": objects})
}

func (s *Server) handleRequests(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"requests": s.log.recent()})
}

// lookup finds the object named by ?bucket=&key=, answering the 4xx itself when it cannot.
func (s *Server) lookup(w http.ResponseWriter, r *http.Request) (objectInfo, bool) {
	q := r.URL.Query()
	obj := object{bucket: q.Get("bucket"), key: q.Get("key")}
	if obj.bucket == "" || obj.key == "" {
		writeAPIError(w, http.StatusBadRequest, "bucket and key are required")
		return objectInfo{}, false
	}
	s.mu.Lock()
	info, ok := readObject(s.path(obj) + ".json")
	s.mu.Unlock()
	if !ok {
		writeAPIError(w, http.StatusNotFound, "no such object")
	}
	return info, ok
}

func (s *Server) handleObject(w http.ResponseWriter, r *http.Request) {
	info, ok := s.lookup(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, objectDetail{objectInfo: info, Headers: map[string]string{
		"Content-Type":   info.ContentType,
		"Content-Length": strconv.FormatInt(info.Size, 10),
		"ETag":           info.ETag,
		"Last-Modified":  info.LastModified.Format(http.TimeFormat),
	}})
}

// handleRaw streams the bytes; ?download=1 asks the browser to save rather than show them.
func (s *Server) handleRaw(w http.ResponseWriter, r *http.Request) {
	info, ok := s.lookup(w, r)
	if !ok {
		return
	}
	f, _, err := openRegular(s.path(object{bucket: info.Bucket, key: info.Key}))
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "no such object")
		return
	}
	defer func() { _ = f.Close() }()
	w.Header().Set("Content-Type", info.ContentType)
	setSafeServing(w.Header(), info.ContentType, info.Key, r.URL.Query().Get("download") != "")
	http.ServeContent(w, r, "", info.LastModified, f)
}
