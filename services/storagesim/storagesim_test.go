package storagesim

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

var devKey = aws.Credentials{AccessKeyID: "storagesim", SecretAccessKey: "storagesim"}

type testStore struct {
	*httptest.Server
	dir string
}

func newTestServer(t *testing.T, origins ...string) testStore {
	t.Helper()
	return newTestServerWith(t, Config{CORSOrigins: origins})
}

func newTestServerWith(t *testing.T, cfg Config) testStore {
	t.Helper()
	cfg.DataDir = filepath.Join(t.TempDir(), "data")
	s, err := NewServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return testStore{Server: srv, dir: cfg.DataDir}
}

// sdk is the AWS SDK's own S3 client, path-style at the store, as the product configures it.
func (ts testStore) sdk(key aws.Credentials) *s3.Client {
	return s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(ts.URL),
		UsePathStyle: true,
		Credentials:  aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) { return key, nil }),
	})
}

func do(t *testing.T, method, url string, body io.Reader, headers map[string]string) (*http.Response, string) {
	t.Helper()
	return send(t, newRequest(t, method, url, body, headers))
}

// doSigned header-signs the request with the dev key and an unsigned payload.
func doSigned(t *testing.T, method, url string, body io.Reader, headers map[string]string) (*http.Response, string) {
	t.Helper()
	req := newRequest(t, method, url, body, headers)
	if req.Header.Get("X-Amz-Content-Sha256") == "" {
		req.Header.Set("X-Amz-Content-Sha256", unsignedPayload)
	}
	if err := v4.NewSigner().SignHTTP(t.Context(), devKey, req, req.Header.Get("X-Amz-Content-Sha256"), "s3", "auto", time.Now()); err != nil {
		t.Fatal(err)
	}
	return send(t, req)
}

func newRequest(t *testing.T, method, url string, body io.Reader, headers map[string]string) *http.Request {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return req
}

func send(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return resp, string(b)
}

func presignPut(t *testing.T, ts testStore, key, contentType string, length int64) string {
	t.Helper()
	signed, err := s3.NewPresignClient(ts.sdk(devKey)).PresignPutObject(t.Context(), &s3.PutObjectInput{
		Bucket: aws.String("langwatch"), Key: aws.String(key), ContentType: aws.String(contentType), ContentLength: aws.Int64(length),
	}, s3.WithPresignExpires(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return signed.URL
}

func errorCode(err error) string {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		return apiErr.ErrorCode()
	}
	return ""
}

// @scenario "A presigned upload round-trips"
func TestPresignedPutThenHeadAndGet(t *testing.T) {
	ts := newTestServer(t)
	put, _ := do(t, http.MethodPut, presignPut(t, ts, "projects/p1/file.txt", "text/plain", 5),
		strings.NewReader("hello"), map[string]string{"Content-Type": "text/plain"})
	const etag = `"5d41402abc4b2a76b9719d911017c592"` // md5("hello")
	if put.StatusCode != http.StatusOK || put.Header.Get("ETag") != etag {
		t.Fatalf("PUT = %d etag %q", put.StatusCode, put.Header.Get("ETag"))
	}

	client := ts.sdk(devKey)
	head, err := client.HeadObject(t.Context(), &s3.HeadObjectInput{Bucket: aws.String("langwatch"), Key: aws.String("projects/p1/file.txt")})
	if err != nil || aws.ToInt64(head.ContentLength) != 5 || aws.ToString(head.ContentType) != "text/plain" || aws.ToString(head.ETag) != etag {
		t.Fatalf("HEAD = %v %+v", err, head)
	}

	link, err := s3.NewPresignClient(client).PresignGetObject(t.Context(), &s3.GetObjectInput{Bucket: aws.String("langwatch"), Key: aws.String("projects/p1/file.txt")})
	if err != nil {
		t.Fatal(err)
	}
	get, body := do(t, http.MethodGet, link.URL, nil, nil)
	if get.StatusCode != http.StatusOK || body != "hello" || get.Header.Get("X-Content-Type-Options") != "nosniff" ||
		get.Header.Get("Content-Disposition") != "" {
		t.Fatalf("GET = %d %q %v", get.StatusCode, body, get.Header)
	}
}

// @scenario "The product's S3 client reads, writes and deletes through storagesim"
func TestSDKClientRoundTrip(t *testing.T) {
	ts := newTestServerWith(t, Config{Buckets: []string{"langwatch"}})
	client := ts.sdk(devKey)
	ctx, bucket, key := t.Context(), aws.String("langwatch"), aws.String("datasets/a b+c.csv")
	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: bucket}); err != nil {
		t.Fatalf("HeadBucket: %v", err)
	}
	if _, err := client.PutObject(ctx, &s3.PutObjectInput{Bucket: bucket, Key: key, Body: bytes.NewReader([]byte("a,b\n1,2\n")), ContentType: aws.String("text/csv")}); err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	got, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: bucket, Key: key})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	body, _ := io.ReadAll(got.Body)
	_ = got.Body.Close()
	if string(body) != "a,b\n1,2\n" || aws.ToString(got.ContentType) != "text/csv" || !strings.HasPrefix(aws.ToString(got.ContentDisposition), "attachment") {
		t.Fatalf("GetObject = %q %q %q", body, aws.ToString(got.ContentType), aws.ToString(got.ContentDisposition))
	}
	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: bucket, Key: key}); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	if _, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: bucket, Key: key}); errorCode(err) != "NoSuchKey" {
		t.Fatalf("GetObject after delete = %v", err)
	}
}

// @scenario "A streamed SDK upload is stored without its chunk framing"
func TestAWSChunkedPutIsDecoded(t *testing.T) {
	ts := newTestServer(t)
	object := ts.URL + "/langwatch/chunked"
	framed := "3;chunk-signature=aa\r\nhel\r\n2;chunk-signature=bb\r\nlo\r\n0;chunk-signature=cc\r\nx-amz-checksum-crc32:AAAA\r\n\r\n"
	put, body := doSigned(t, http.MethodPut, object, strings.NewReader(framed), map[string]string{
		"X-Amz-Content-Sha256":         "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
		"X-Amz-Decoded-Content-Length": "5",
	})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT = %d %s", put.StatusCode, body)
	}
	if _, body := doSigned(t, http.MethodGet, object, nil, nil); body != "hello" {
		t.Fatalf("GET = %q, want the decoded bytes", body)
	}
}

// @scenario "A missing key reads as S3 reads it"
func TestMissingKeyIsNoSuchKey(t *testing.T) {
	ts := newTestServer(t)
	get, body := doSigned(t, http.MethodGet, ts.URL+"/langwatch/nope", nil, nil)
	if get.StatusCode != http.StatusNotFound || !strings.Contains(body, "<Code>NoSuchKey</Code>") ||
		get.Header.Get("Content-Type") != "application/xml" {
		t.Fatalf("GET = %d %q", get.StatusCode, body)
	}
	head, headBody := doSigned(t, http.MethodHead, ts.URL+"/langwatch/nope", nil, nil)
	if head.StatusCode != http.StatusNotFound || headBody != "" {
		t.Fatalf("HEAD = %d %q", head.StatusCode, headBody)
	}
}

// @scenario "A bucket storagesim does not hold answers NoSuchBucket"
func TestUnknownBucketIsNoSuchBucket(t *testing.T) {
	ts := newTestServerWith(t, Config{Buckets: []string{"langwatch"}})
	get, body := doSigned(t, http.MethodGet, ts.URL+"/elsewhere/k", nil, nil)
	if get.StatusCode != http.StatusNotFound || !strings.Contains(body, "<Code>NoSuchBucket</Code>") {
		t.Fatalf("GET = %d %q", get.StatusCode, body)
	}
	if _, err := ts.sdk(devKey).HeadBucket(t.Context(), &s3.HeadBucketInput{Bucket: aws.String("elsewhere")}); err == nil {
		t.Fatal("HeadBucket on an unknown bucket succeeded")
	}
}

// @scenario "A request without a valid signature is refused as S3 refuses it"
func TestUnsignedAndMissignedRequestsAreRefused(t *testing.T) {
	ts := newTestServer(t)
	anonymous, body := do(t, http.MethodGet, ts.URL+"/langwatch/k", nil, nil)
	if anonymous.StatusCode != http.StatusForbidden || !strings.Contains(body, "<Code>AccessDenied</Code>") {
		t.Fatalf("anonymous = %d %q", anonymous.StatusCode, body)
	}
	tampered := strings.Replace(presignPut(t, ts, "k", "text/plain", 5), "X-Amz-Signature=", "X-Amz-Signature=0", 1)
	if resp, body := do(t, http.MethodPut, tampered, strings.NewReader("hello"), map[string]string{"Content-Type": "text/plain"}); resp.StatusCode != http.StatusForbidden ||
		!strings.Contains(body, "<Code>SignatureDoesNotMatch</Code>") {
		t.Fatalf("tampered = %d %q", resp.StatusCode, body)
	}
	_, err := ts.sdk(aws.Credentials{AccessKeyID: "storagesim", SecretAccessKey: "wrong"}).
		HeadBucket(t.Context(), &s3.HeadBucketInput{Bucket: aws.String("langwatch")})
	if err == nil {
		t.Fatal("a wrong secret was accepted")
	}
	_, err = ts.sdk(aws.Credentials{AccessKeyID: "someone", SecretAccessKey: "storagesim"}).
		PutObject(t.Context(), &s3.PutObjectInput{Bucket: aws.String("langwatch"), Key: aws.String("k"), Body: strings.NewReader("x")})
	if errorCode(err) != "InvalidAccessKeyId" {
		t.Fatalf("unknown key = %v", err)
	}
}

// @scenario "An upload that differs from what was presigned is refused"
func TestPresignedHeadersAreEnforced(t *testing.T) {
	ts := newTestServer(t)
	url := presignPut(t, ts, "k", "text/plain", 5)
	for name, tc := range map[string]struct{ body, contentType string }{
		"longer body":        {"hello!", "text/plain"},
		"other content type": {"hello", "text/html"},
	} {
		resp, body := do(t, http.MethodPut, url, strings.NewReader(tc.body), map[string]string{"Content-Type": tc.contentType})
		if resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "<Code>SignatureDoesNotMatch</Code>") {
			t.Fatalf("%s = %d %q", name, resp.StatusCode, body)
		}
	}
}

// @scenario "A presigned URL past its expiry is refused"
func TestExpiredPresignIsRefused(t *testing.T) {
	ts := newTestServer(t)
	req := newRequest(t, http.MethodGet, ts.URL+"/langwatch/k?X-Amz-Expires=60", nil, nil)
	url, _, err := v4.NewSigner().PresignHTTP(t.Context(), devKey, req, unsignedPayload, "s3", "auto", time.Now().Add(-2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	resp, body := do(t, http.MethodGet, url, nil, nil)
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(body, "<Code>AccessDenied</Code>") ||
		!strings.Contains(body, "<Message>Request has expired</Message>") {
		t.Fatalf("expired = %d %q", resp.StatusCode, body)
	}
}

// @scenario "A key that reads as a path is refused"
func TestPathLikeKeysAreRefused(t *testing.T) {
	ts := newTestServer(t)
	for _, target := range []string{"/langwatch/../escape", "/langwatch/a/./b", "/langwatch//etc/passwd", "/langwatch/nul%00byte", "/langwatch/a%5C..%5Cb"} {
		resp, body := doSigned(t, http.MethodPut, ts.URL+target, strings.NewReader("x"), nil)
		if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "<Code>InvalidArgument</Code>") {
			t.Fatalf("PUT %s = %d %q", target, resp.StatusCode, body)
		}
	}
	if entries, _ := os.ReadDir(filepath.Dir(ts.dir)); len(entries) != 1 {
		t.Fatalf("something was written beside the data dir: %v", entries)
	}
}

// @scenario "Stored objects are owner-only files that are never executable"
func TestStoredFilesAreOwnerOnly(t *testing.T) {
	ts := newTestServer(t)
	if resp, body := doSigned(t, http.MethodPut, ts.URL+"/langwatch/run.sh", strings.NewReader("#!/bin/sh\n"), map[string]string{"Content-Type": "text/x-shellscript"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT = %d %q", resp.StatusCode, body)
	}
	if info, err := os.Stat(ts.dir); err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("data dir mode = %v %v", info.Mode(), err)
	}
	entries, _ := os.ReadDir(ts.dir)
	if len(entries) != 2 {
		t.Fatalf("want the object and its sidecar, got %v", entries)
	}
	for _, entry := range entries {
		info, _ := entry.Info()
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || strings.Contains(entry.Name(), "run") {
			t.Fatalf("%s mode = %v", entry.Name(), info.Mode())
		}
	}
	get, _ := doSigned(t, http.MethodGet, ts.URL+"/langwatch/run.sh", nil, nil)
	if get.Header.Get("X-Content-Type-Options") != "nosniff" || get.Header.Get("Content-Security-Policy") != "sandbox" ||
		!strings.HasPrefix(get.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("GET headers = %v", get.Header)
	}
}

// @scenario "A browser on the app origin may upload"
func TestCORSPreflightFromTheAppOrigin(t *testing.T) {
	const app = "https://app.feat-x.langwatch.localhost:1355"
	ts := newTestServer(t, app)
	preflight := map[string]string{
		"Origin":                         app,
		"Access-Control-Request-Method":  "PUT",
		"Access-Control-Request-Headers": "content-type",
	}
	resp, _ := do(t, http.MethodOptions, ts.URL+"/langwatch/k", nil, preflight)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Access-Control-Allow-Origin") != app ||
		!strings.Contains(resp.Header.Get("Access-Control-Allow-Methods"), "PUT") ||
		resp.Header.Get("Access-Control-Allow-Headers") != "content-type" {
		t.Fatalf("preflight = %d %v", resp.StatusCode, resp.Header)
	}

	preflight["Origin"] = "https://evil.example"
	refused, _ := do(t, http.MethodOptions, ts.URL+"/langwatch/k", nil, preflight)
	if refused.StatusCode != http.StatusForbidden || refused.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign preflight = %d %v", refused.StatusCode, refused.Header)
	}
}

func TestSeedStoresSampleObjectsReadableOverS3(t *testing.T) {
	ts := newTestServerWith(t, Config{Seed: true})
	out, err := ts.sdk(devKey).GetObject(t.Context(), &s3.GetObjectInput{Bucket: aws.String("langwatch"), Key: aws.String("seed/hello.txt")})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = out.Body.Close() }()
	body, _ := io.ReadAll(out.Body)
	if string(body) != "Hello from storagesim.\n" || aws.ToString(out.ContentType) != "text/plain" {
		t.Fatalf("seeded object = %q %q", body, aws.ToString(out.ContentType))
	}
}
