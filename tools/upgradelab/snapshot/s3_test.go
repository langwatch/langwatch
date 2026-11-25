package snapshot

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

var testCredentials = Credentials{AccessKeyID: "AKIDUPGRADELABTEST", SecretAccessKey: "fake-s3-secret-for-tests-only"}

// listTokenPrefix holds '+', '/' and '=' so a token that is not escaped on the wire breaks the listing.
const listTokenPrefix = "next+/="

type fakeS3Seen struct {
	requests, lists, puts, unsigned int
	lastAuthorization               string
}

// fakeS3 is an S3 endpoint for httptest: ListObjectsV2 in pages of two, GetObject, PutObject and
// HeadBucket, path-style or virtual-host. It re-signs every request with the test credentials.
type fakeS3 struct {
	mu      sync.Mutex
	buckets map[string]map[string][]byte
	refuse  int
	seen    fakeS3Seen
}

func (fake *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	fake.seen.requests++
	fake.seen.lastAuthorization = r.Header.Get("Authorization")
	if fake.refuse != 0 {
		w.WriteHeader(fake.refuse)
		fmt.Fprintf(w, "<Error><Code>SignatureDoesNotMatch</Code><AWSAccessKeyId>%s</AWSAccessKeyId><SignatureProvided>%s</SignatureProvided></Error>",
			testCredentials.AccessKeyID, fake.seen.lastAuthorization)
		return
	}
	if !signedCorrectly(r) {
		fake.seen.unsigned++
		w.WriteHeader(http.StatusForbidden)
		return
	}
	bucket, key := fake.locate(r)
	objects, found := fake.buckets[bucket]
	switch {
	case !found:
		w.WriteHeader(http.StatusNotFound)
	case key == "" && r.Method == http.MethodGet:
		fake.seen.lists++
		writeListPage(w, objects, r.URL.Query().Get("continuation-token"))
	case key == "":
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodPut:
		objects[key], _ = io.ReadAll(r.Body)
		fake.seen.puts++
	default:
		serveFakeObject(w, objects, key)
	}
}

func (fake *fakeS3) locate(r *http.Request) (string, string) {
	if name, _, found := strings.Cut(r.Host, "."); found && fake.buckets[name] != nil {
		return name, strings.TrimPrefix(r.URL.Path, "/")
	}
	bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	return bucket, key
}

func (fake *fakeS3) observed() fakeS3Seen {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return fake.seen
}

func (fake *fakeS3) bucket(name string) map[string][]byte {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	return maps.Clone(fake.buckets[name])
}

func (fake *fakeS3) refuseWith(status int) {
	fake.mu.Lock()
	defer fake.mu.Unlock()
	fake.refuse = status
}

// signedCorrectly re-signs the request as it arrived and checks the payload hash against the body.
func signedCorrectly(r *http.Request) bool {
	when, err := time.Parse(amzDateLayout, r.Header.Get("X-Amz-Date"))
	if err != nil {
		return false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	clone := r.Clone(r.Context())
	clone.Header.Del("Authorization")
	err = sigV4{credentials: testCredentials, region: "us-east-1", service: "s3"}.sign(clone, when)
	return err == nil && clone.Header.Get("Authorization") == r.Header.Get("Authorization") && r.Header.Get("X-Amz-Content-Sha256") == hexSHA256(body)
}

func writeListPage(w io.Writer, objects map[string][]byte, token string) {
	keys := slices.Sorted(maps.Keys(objects))
	start, _ := strconv.Atoi(strings.TrimPrefix(token, listTokenPrefix))
	end := min(start+2, len(keys))
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>%t</IsTruncated>`, end < len(keys))
	for _, key := range keys[start:end] {
		fmt.Fprint(w, "<Contents><Key>")
		_ = xml.EscapeText(w, []byte(key))
		fmt.Fprint(w, "</Key><Size>1</Size></Contents>")
	}
	if end < len(keys) {
		fmt.Fprintf(w, "<NextContinuationToken>%s%d</NextContinuationToken>", listTokenPrefix, end)
	}
	fmt.Fprint(w, "</ListBucketResult>")
}

func serveFakeObject(w http.ResponseWriter, objects map[string][]byte, key string) {
	body, found := objects[key]
	if !found {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, "<Error><Code>NoSuchKey</Code></Error>")
		return
	}
	_, _ = w.Write(body)
}

func startFakeS3(t *testing.T, buckets map[string]map[string][]byte) (*fakeS3, *httptest.Server) {
	t.Helper()
	fake := &fakeS3{buckets: buckets}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	return fake, server
}

func newTestS3(t *testing.T, raw string) *S3 {
	t.Helper()
	store, err := NewS3(raw, testCredentials)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

// virtualTestS3 addresses <bucket>.s3.test and dials the test server whatever the host.
func virtualTestS3(t *testing.T, server *httptest.Server, bucket string) *S3 {
	t.Helper()
	store := newTestS3(t, "http://s3.test/"+bucket+"?addressing=virtual")
	address := server.Listener.Addr().String()
	store.client = &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}}}
	return store
}

func oneObjectSnapshot(t *testing.T) string {
	t.Helper()
	source := &fakeObjects{bucket: "langwatch", objects: map[string][]byte{"exports/a.csv": []byte("a,b")}}
	dir, _, err := captureInto(t, Stores{Objects: source}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	return dir
}

// @scenario "Capture lists and reads every object in an S3 bucket"
func TestS3CaptureListsAndReadsEveryObject(t *testing.T) {
	source := map[string][]byte{
		"datasets/proj_1/rows.jsonl":       []byte(`{"input":"hello"}`),
		"datasets/proj 1/ünïcode+plus.txt": []byte("an awkward key"),
		"traces/proj_1/2026/10/09.bin":     {0, 1, 2, 255},
		"exports/a.csv":                    []byte("a,b"),
		"exports/b.csv":                    []byte("c,d"),
	}
	fake, server := startFakeS3(t, map[string]map[string][]byte{"langwatch": maps.Clone(source), "upgradelab-objects": {}})
	dir, manifest, err := captureInto(t, Stores{Objects: newTestS3(t, server.URL+"/langwatch")}, Scrubber{})
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if manifest.ObjectCount != len(source) {
		t.Fatalf("objectCount = %d, want %d", manifest.ObjectCount, len(source))
	}
	if seen := fake.observed(); seen.lists < 3 || seen.unsigned > 0 {
		t.Fatalf("want every list page followed and every request signed; saw %d list pages, %d unsigned", seen.lists, seen.unsigned)
	}
	_, err = Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Objects: virtualTestS3(t, server, "upgradelab-objects")}})
	if err != nil {
		t.Fatalf("restore over virtual-host addressing: %v", err)
	}
	if restored := fake.bucket("upgradelab-objects"); !reflect.DeepEqual(restored, source) {
		t.Fatalf("restored objects differ: %v", slices.Sorted(maps.Keys(restored)))
	}
}

// @scenario "Restore into S3 refuses a bucket whose name lacks the upgradelab- prefix"
func TestS3RestoreRefusesANonDedicatedBucket(t *testing.T) {
	dir := oneObjectSnapshot(t)
	fake, server := startFakeS3(t, map[string]map[string][]byte{"langwatch": {}})
	_, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Objects: newTestS3(t, server.URL+"/langwatch")}})
	if err == nil || !strings.Contains(err.Error(), DedicatedBucketPrefix) || fake.observed().puts != 0 {
		t.Fatalf("restore into a stack's own bucket: want a refusal naming the prefix and no write; got %v, %d puts", err, fake.observed().puts)
	}
}

// @scenario "Restore into S3 refuses a bucket that is not empty"
func TestS3RestoreRefusesANonEmptyBucket(t *testing.T) {
	dir := oneObjectSnapshot(t)
	fake, server := startFakeS3(t, map[string]map[string][]byte{"upgradelab-objects": {"left/over.txt": []byte("x")}})
	_, err := Restore(context.Background(), RestoreInput{Dir: dir, Stores: Stores{Objects: newTestS3(t, server.URL+"/upgradelab-objects")}})
	if err == nil || !strings.Contains(err.Error(), "not empty") || fake.observed().puts != 0 {
		t.Fatalf("restore into a non-empty bucket: want a refusal and no write; got %v, %d puts", err, fake.observed().puts)
	}
}

// @scenario "A signing failure or a refused request names the bucket and key, never the credentials"
func TestS3ErrorsNameBucketAndKeyNeverCredentials(t *testing.T) {
	fake, server := startFakeS3(t, map[string]map[string][]byte{"upgradelab-objects": {}})
	unsigned, err := NewS3(server.URL+"/upgradelab-objects", Credentials{AccessKeyID: testCredentials.AccessKeyID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = unsigned.Get(context.Background(), "exports/a.csv")
	if !errors.Is(err, errNoCredentials) || !strings.Contains(err.Error(), "upgradelab-objects/exports/a.csv") || fake.observed().requests != 0 {
		t.Fatalf("no secret: want a refusal naming bucket and key before any request; got %v, %d requests", err, fake.observed().requests)
	}
	fake.refuseWith(http.StatusForbidden)
	_, err = newTestS3(t, server.URL+"/upgradelab-objects").Get(context.Background(), "exports/a.csv")
	_, signature, _ := strings.Cut(fake.observed().lastAuthorization, "Signature=")
	if leaks(fmt.Sprint(err), testCredentials.AccessKeyID, testCredentials.SecretAccessKey, signature) {
		t.Fatal("a refused request's error carries a credential or the signature")
	}
	var refused *S3Error
	if !errors.As(err, &refused) || refused.Status != http.StatusForbidden || refused.Code != "SignatureDoesNotMatch" || !strings.Contains(err.Error(), "upgradelab-objects/exports/a.csv") {
		t.Fatalf("403: want the status, the S3 code, the bucket and the key; got %v", err)
	}
}

// leaks reports whether message holds any secret; an empty secret counts, so the test cannot pass vacuously.
func leaks(message string, secrets ...string) bool {
	return slices.ContainsFunc(secrets, func(secret string) bool { return secret == "" || strings.Contains(message, secret) })
}

func TestNewS3RefusesCredentialsInTheURL(t *testing.T) {
	_, err := NewS3("http://minio:hunter2@localhost:9000/upgradelab-objects", testCredentials)
	if err == nil || strings.Contains(err.Error(), "hunter2") {
		t.Fatalf("credentials in the URL: want a refusal that never quotes them; got %v", err)
	}
}
