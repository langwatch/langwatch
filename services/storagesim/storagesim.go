// Package storagesim is haven's local S3: the path-style calls the product
// makes (PUT, GET, HEAD, DELETE object; HEAD/PUT bucket), answered as S3
// answers them, SigV4 (header or presigned query) checked against one dev key.
// Objects are content-addressed 0600 files in one 0700 data directory, served
// nosniff and sandboxed. See README.md for what it leaves out.
package storagesim

import (
	"bufio"
	"context"
	"crypto/md5" //nolint:gosec // S3 defines the ETag as the body's MD5
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"hash"
	"hash/fnv"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// objectStripes is how many independent object locks there are; a power of two.
const objectStripes = 64

// maxObjectSize is S3's single-PUT ceiling.
const maxObjectSize = 5 << 30

// Config is storagesim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (STORAGESIM_ADDR, default :5590).
	Addr string
	// DataDir holds every object (STORAGESIM_DATA_DIR, default <tmp>/storagesim).
	DataDir string
	// CORSOrigins are the browser origins allowed to call it
	// (STORAGESIM_CORS_ORIGINS, comma-separated). Empty allows any origin.
	CORSOrigins []string
	// AccessKeyID and SecretAccessKey sign every S3 call (STORAGESIM_ACCESS_KEY_ID,
	// STORAGESIM_SECRET_ACCESS_KEY; both default to haven's "storagesim").
	AccessKeyID, SecretAccessKey string
	// Buckets exist from the start (STORAGESIM_BUCKETS, comma-separated). Empty
	// means every bucket exists; otherwise others answer NoSuchBucket until created.
	Buckets []string
	// Seed stores a couple of sample objects in the langwatch bucket at start
	// (STORAGESIM_SEED=1).
	Seed bool
}

// LoadConfig reads storagesim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{
		Addr:            os.Getenv("STORAGESIM_ADDR"),
		DataDir:         os.Getenv("STORAGESIM_DATA_DIR"),
		AccessKeyID:     os.Getenv("STORAGESIM_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("STORAGESIM_SECRET_ACCESS_KEY"),
		CORSOrigins:     splitList(os.Getenv("STORAGESIM_CORS_ORIGINS")),
		Buckets:         splitList(os.Getenv("STORAGESIM_BUCKETS")),
		Seed:            os.Getenv("STORAGESIM_SEED") == "1",
	}
	if cfg.Addr == "" {
		cfg.Addr = ":5590"
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Join(os.TempDir(), "storagesim")
	}
	return cfg
}

func splitList(raw string) []string {
	var out []string
	for item := range strings.SplitSeq(raw, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// Server answers the S3 calls over the data directory.
type Server struct {
	cfg Config
	now func() time.Time
	// stripes serialize writes against reads of the same object, so load on
	// one key never blocks another; bucketMu guards the bucket set alone.
	stripes  [objectStripes]sync.Mutex
	bucketMu sync.RWMutex
	buckets  map[string]bool // nil: every bucket exists
	// console is the embedded bundle; log holds the recent S3 requests it lists.
	console  http.Handler
	log      *requestLog
	requests atomic.Uint64
}

// meta is what S3 answers about an object beyond its bytes.
type meta struct {
	Bucket      string `json:"bucket"`
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	ETag        string `json:"etag"`
}

// NewServer creates the owner-only data directory and the server over it.
func NewServer(cfg Config) (*Server, error) {
	if cfg.AccessKeyID == "" {
		cfg.AccessKeyID = "storagesim"
	}
	if cfg.SecretAccessKey == "" {
		cfg.SecretAccessKey = "storagesim"
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("creating %s: %w", cfg.DataDir, err)
	}
	if err := os.Chmod(cfg.DataDir, 0o700); err != nil { //nolint:gosec // G302: a directory needs its owner execute bit to be traversed
		return nil, fmt.Errorf("restricting %s: %w", cfg.DataDir, err)
	}
	s := &Server{cfg: cfg, now: time.Now, console: newConsole(embeddedConsole()), log: newRequestLog()}
	if len(cfg.Buckets) > 0 {
		s.buckets = map[string]bool{}
		for _, b := range cfg.Buckets {
			s.buckets[b] = true
		}
	}
	if cfg.Seed {
		if err := s.seed(); err != nil {
			return nil, fmt.Errorf("seeding %s: %w", cfg.DataDir, err)
		}
	}
	return s, nil
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serveHTTP)
}

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/_sim" || strings.HasPrefix(r.URL.Path, "/_sim/") {
		s.serveConsole(w, r)
		return
	}
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	s.serveS3(rec, r)
	bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if bucket != "healthz" || key != "" {
		s.log.add(requestEntry{Method: r.Method, Bucket: bucket, Key: key, Status: rec.status, At: time.Now()})
	}
}

func (s *Server) serveS3(w http.ResponseWriter, r *http.Request) {
	requestID := fmt.Sprintf("%016X", s.requests.Add(1))
	w.Header().Set("x-amz-request-id", requestID)
	if !s.applyCORS(w, r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	x := exchange{w: w, r: r, requestID: requestID}
	bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	obj := object{bucket: bucket, key: key}
	switch {
	case r.Method == http.MethodOptions, bucket == "healthz" && key == "":
		w.WriteHeader(http.StatusOK)
		return
	case bucket == "" && r.Method == http.MethodGet:
		http.Redirect(w, r, "/_sim/", http.StatusFound)
		return
	case bucket == "":
		x.fail(obj.fail(http.StatusNotImplemented, "NotImplemented", "storagesim serves path-style bucket requests only"))
		return
	}
	if e := validate(obj); e != nil {
		x.fail(*e)
		return
	}
	if e := s.authenticate(r, obj); e != nil {
		x.fail(*e)
		return
	}
	if key == "" {
		s.serveBucket(x, obj)
		return
	}
	s.serveObject(x, obj)
}

// serveObject answers PutObject, GetObject, HeadObject and DeleteObject.
func (s *Server) serveObject(x exchange, obj object) {
	w, r := x.w, x.r
	if !s.bucketExists(obj.bucket) {
		x.fail(obj.noSuchBucket())
		return
	}
	var e *s3Error
	switch r.Method {
	case http.MethodPut:
		e = s.putObject(w, r, obj)
	case http.MethodGet, http.MethodHead:
		e = s.getObject(w, r, obj)
	case http.MethodDelete:
		s.deleteObject(obj)
		w.WriteHeader(http.StatusNoContent)
	default:
		e = new(obj.fail(http.StatusMethodNotAllowed, "MethodNotAllowed", "The specified method is not allowed against this resource."))
	}
	if e != nil {
		x.fail(*e)
	}
}

var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// validate refuses names S3 would, and every key that could read as a path:
// storage is content-addressed, so this is belt and braces.
func validate(obj object) *s3Error {
	if !bucketName.MatchString(obj.bucket) {
		e := obj.fail(http.StatusBadRequest, "InvalidBucketName", "The specified bucket is not valid.")
		e.BucketName = obj.bucket
		return &e
	}
	if len(obj.key) > 1024 {
		return new(obj.fail(http.StatusBadRequest, "KeyTooLongError", "Your key is too long"))
	}
	if strings.ContainsRune(obj.key, 0) || strings.HasPrefix(obj.key, "/") || strings.Contains(obj.key, `\`) ||
		slices.ContainsFunc(strings.Split(obj.key, "/"), func(seg string) bool { return seg == "." || seg == ".." }) {
		return new(obj.fail(http.StatusBadRequest, "InvalidArgument", "storagesim refuses keys with NUL, a leading slash, a backslash or a . or .. segment"))
	}
	return nil
}

func (s *Server) bucketExists(bucket string) bool {
	s.bucketMu.RLock()
	defer s.bucketMu.RUnlock()
	return s.buckets == nil || s.buckets[bucket]
}

// serveBucket answers HeadBucket and CreateBucket.
func (s *Server) serveBucket(x exchange, obj object) {
	w := x.w
	switch x.r.Method {
	case http.MethodPut:
		s.bucketMu.Lock()
		if s.buckets != nil {
			s.buckets[obj.bucket] = true
		}
		s.bucketMu.Unlock()
		w.Header().Set("Location", "/"+obj.bucket)
		w.WriteHeader(http.StatusOK)
	case http.MethodHead:
		if !s.bucketExists(obj.bucket) {
			x.fail(obj.noSuchBucket())
			return
		}
		w.WriteHeader(http.StatusOK)
	default:
		x.fail(obj.fail(http.StatusNotImplemented, "NotImplemented", "storagesim does not list or configure buckets"))
	}
}

// applyCORS sets the CORS answer for an Origin, and reports whether it is allowed.
func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if len(s.cfg.CORSOrigins) > 0 && !slices.Contains(s.cfg.CORSOrigins, origin) {
		return false
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Add("Vary", "Origin")
	h.Set("Access-Control-Expose-Headers", "ETag")
	if r.Method == http.MethodOptions {
		h.Set("Access-Control-Allow-Methods", "GET, PUT, HEAD, DELETE")
		h.Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
		h.Set("Access-Control-Max-Age", "600")
		if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
			h.Set("Access-Control-Allow-Private-Network", "true")
		}
	}
	return true
}

// object is one (bucket, key) the SDK addressed path-style.
type object struct{ bucket, key string }

func (o object) fail(status int, code, message string) s3Error {
	resource := "/" + o.bucket
	if o.key != "" {
		resource += "/" + o.key
	}
	return s3Error{Status: status, Code: code, Message: message, Resource: resource}
}

func (o object) noSuchBucket() s3Error {
	e := o.fail(http.StatusNotFound, "NoSuchBucket", "The specified bucket does not exist")
	e.BucketName = o.bucket
	return e
}

// path is a flat, traversal-proof file name for the object.
func (s *Server) path(obj object) string {
	sum := sha256.Sum256([]byte(obj.bucket + "/" + obj.key))
	return filepath.Join(s.cfg.DataDir, hex.EncodeToString(sum[:]))
}

// lockObject takes the stripe the object's file name hashes to and returns its unlock.
func (s *Server) lockObject(target string) (unlock func()) {
	h := fnv.New32a()
	_, _ = io.WriteString(h, target)
	mu := &s.stripes[h.Sum32()%objectStripes]
	mu.Lock()
	return mu.Unlock
}

// expectedLength is the body length S3 requires up front: Content-Length, or
// x-amz-decoded-content-length under aws-chunked framing.
func expectedLength(r *http.Request, obj object) (int64, *s3Error) {
	n := r.ContentLength
	if isStreaming(r) {
		var err error
		if n, err = strconv.ParseInt(r.Header.Get("X-Amz-Decoded-Content-Length"), 10, 64); err != nil {
			n = -1
		}
	}
	switch {
	case n < 0:
		return 0, new(obj.fail(http.StatusLengthRequired, "MissingContentLength", "You must provide the Content-Length HTTP header."))
	case n > maxObjectSize:
		return 0, new(obj.fail(http.StatusBadRequest, "EntityTooLarge", "Your proposed upload exceeds the maximum allowed size"))
	}
	return n, nil
}

func isStreaming(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("X-Amz-Content-Sha256"), "STREAMING-")
}

func (s *Server) putObject(w http.ResponseWriter, r *http.Request, obj object) *s3Error {
	want, e := expectedLength(r, obj)
	if e != nil {
		return e
	}
	body := io.Reader(r.Body)
	// The SDK streams with aws-chunked framing when it signs or checksums per chunk.
	if isStreaming(r) {
		body = &awsChunkedReader{src: bufio.NewReader(r.Body)}
	}
	tmp, err := os.CreateTemp(s.cfg.DataDir, ".put-*") // 0600, never executable
	if err != nil {
		return new(obj.fail(http.StatusInternalServerError, "InternalError", err.Error()))
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	md5sum, sha := md5.New(), sha256.New() //nolint:gosec // S3's ETag is the body's MD5
	n, copyErr := io.Copy(io.MultiWriter(tmp, md5sum, sha), io.LimitReader(body, want+1))
	if err := errors.Join(copyErr, tmp.Close()); err != nil || n != want {
		return new(obj.fail(http.StatusBadRequest, "IncompleteBody", "You did not provide the number of bytes specified by the Content-Length HTTP header."))
	}
	if claimed := r.Header.Get("X-Amz-Content-Sha256"); isHexSHA256(claimed) && claimed != hexOf(sha) {
		return new(obj.fail(http.StatusBadRequest, "XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed."))
	}
	m := meta{Bucket: obj.bucket, Key: obj.key, ContentType: r.Header.Get("Content-Type"), ETag: `"` + hexOf(md5sum) + `"`}
	if m.ContentType == "" {
		m.ContentType = "binary/octet-stream"
	}
	raw, _ := json.Marshal(m)
	target := s.path(obj)
	unlock := s.lockObject(target)
	err = s.writeSidecar(target+".json", raw)
	if err == nil {
		err = os.Rename(tmp.Name(), target) // replaces a planted symlink, never follows it
	}
	unlock()
	if err != nil {
		return new(obj.fail(http.StatusInternalServerError, "InternalError", err.Error()))
	}
	w.Header().Set("ETag", m.ETag)
	w.WriteHeader(http.StatusOK)
	return nil
}

// writeSidecar writes through a 0600 temp file and a rename, so no symlink is followed.
func (s *Server) writeSidecar(target string, raw []byte) error {
	tmp, err := os.CreateTemp(s.cfg.DataDir, ".meta-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	_, writeErr := tmp.Write(raw)
	if err := errors.Join(writeErr, tmp.Close()); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), target)
}

// openRegular opens a plain file only: a symlink or anything else reads as missing.
func openRegular(name string) (*os.File, os.FileInfo, error) {
	before, err := os.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, nil, fmt.Errorf("%s is not a regular file", name)
	}
	f, err := os.Open(name)
	if err != nil {
		return nil, nil, err
	}
	after, err := f.Stat()
	if err != nil || !os.SameFile(before, after) {
		_ = f.Close()
		return nil, nil, fmt.Errorf("%s changed while opening", name)
	}
	return f, after, nil
}

func readMeta(name string) (meta, bool) {
	f, _, err := openRegular(name)
	if err != nil {
		return meta{}, false
	}
	defer func() { _ = f.Close() }()
	var m meta
	return m, json.NewDecoder(f).Decode(&m) == nil
}

func (s *Server) getObject(w http.ResponseWriter, r *http.Request, obj object) *s3Error {
	target := s.path(obj)
	unlock := s.lockObject(target)
	m, ok := readMeta(target + ".json")
	f, info, openErr := openRegular(target)
	unlock()
	if !ok || openErr != nil {
		if f != nil {
			_ = f.Close()
		}
		return new(obj.fail(http.StatusNotFound, "NoSuchKey", "The specified key does not exist."))
	}
	defer func() { _ = f.Close() }()
	h := w.Header()
	h.Set("Content-Type", m.ContentType)
	h.Set("ETag", m.ETag)
	setSafeServing(h, m.ContentType, obj.key)
	http.ServeContent(w, r, "", info.ModTime(), f)
	return nil
}

func (s *Server) deleteObject(obj object) {
	target := s.path(obj)
	defer s.lockObject(target)()
	_ = os.Remove(target)
	_ = os.Remove(target + ".json")
}

// inlineTypes may render in a browser tab; SVG is absent because it can carry script.
var inlineTypes = []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "text/plain"}

// setSafeServing keeps stored bytes inert: never sniffed, sandboxed, and
// downloaded rather than shown unless they are a plain image or text.
func setSafeServing(h http.Header, contentType, key string) {
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox")
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if !slices.Contains(inlineTypes, mediaType) {
		setAttachment(h, key)
	}
}

// setAttachment makes a browser download the bytes under key's base name.
func setAttachment(h http.Header, key string) {
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(key)}))
}

func isHexSHA256(s string) bool {
	_, err := hex.DecodeString(s)
	return len(s) == 64 && err == nil
}

func hexOf(h hash.Hash) string { return hex.EncodeToString(h.Sum(nil)) }

// s3Error is the XML error body the AWS SDK parses into a named exception.
type s3Error struct {
	XMLName           xml.Name `xml:"Error"`
	Status            int      `xml:"-"`
	Code              string   `xml:"Code"`
	Message           string   `xml:"Message"`
	Resource          string   `xml:"Resource,omitempty"`
	BucketName        string   `xml:"BucketName,omitempty"`
	AWSAccessKeyID    string   `xml:"AWSAccessKeyId,omitempty"`
	StringToSign      string   `xml:"StringToSign,omitempty"`
	SignatureProvided string   `xml:"SignatureProvided,omitempty"`
	CanonicalRequest  string   `xml:"CanonicalRequest,omitempty"`
	XAmzExpires       string   `xml:"X-Amz-Expires,omitempty"`
	Expires           string   `xml:"Expires,omitempty"`
	RequestTime       string   `xml:"RequestTime,omitempty"`
	ServerTime        string   `xml:"ServerTime,omitempty"`
	RequestID         string   `xml:"RequestId"`
}

// exchange is one S3 request, its response and the request id it answers with.
type exchange struct {
	w         http.ResponseWriter
	r         *http.Request
	requestID string
}

// fail answers e as S3 does: the XML body, or the bare status on a HEAD.
func (x exchange) fail(e s3Error) {
	w := x.w
	if x.r.Method == http.MethodHead {
		w.WriteHeader(e.Status)
		return
	}
	e.RequestID = x.requestID
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(e.Status)
	_, _ = io.WriteString(w, xml.Header)
	_ = xml.NewEncoder(w).Encode(e)
}

// awsChunkedReader strips aws-chunked framing: `<hex>[;ext]\r\n<data>\r\n`
// repeated, ending at a zero-size chunk whose trailers are ignored.
type awsChunkedReader struct {
	src       *bufio.Reader
	remaining int64
	done      bool
}

func (c *awsChunkedReader) Read(p []byte) (int, error) {
	for c.remaining == 0 {
		if c.done {
			return 0, io.EOF
		}
		if err := c.nextChunk(); err != nil {
			return 0, err
		}
	}
	if int64(len(p)) > c.remaining {
		p = p[:c.remaining]
	}
	n, err := c.src.Read(p)
	c.remaining -= int64(n)
	if c.remaining == 0 && err == nil {
		_, err = c.src.Discard(2) // the chunk's trailing \r\n
	}
	return n, err
}

func (c *awsChunkedReader) nextChunk() error {
	line, err := c.src.ReadString('\n')
	if err != nil {
		return fmt.Errorf("reading aws-chunked header: %w", err)
	}
	sizeHex, _, _ := strings.Cut(strings.TrimSpace(line), ";")
	size, err := strconv.ParseInt(sizeHex, 16, 64)
	if err != nil || size < 0 {
		return fmt.Errorf("bad aws-chunked size %q", sizeHex)
	}
	c.remaining, c.done = size, size == 0
	return nil
}
