package storagesim

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func putKeys(t *testing.T, ts testStore, keys ...string) {
	t.Helper()
	for _, key := range keys {
		put(t, ts.URL, "/langwatch/"+key, "x", "text/plain")
	}
}

func listKeys(out *s3.ListObjectsV2Output) []string {
	var keys []string
	for _, c := range out.Contents {
		keys = append(keys, aws.ToString(c.Key))
	}
	return keys
}

// @scenario "A client lists a bucket's keys with ListObjectsV2"
func TestListObjectsV2ListsKeysInLexicalOrder(t *testing.T) {
	ts := newTestServer(t)
	putKeys(t, ts, "b.txt", "a/2.txt", "a/1.txt")
	put(t, ts.URL, "/other/a/1.txt", "x", "")
	out, err := ts.sdk(devKey).ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("langwatch")})
	if err != nil {
		t.Fatal(err)
	}
	if got := listKeys(out); !slices.Equal(got, []string{"a/1.txt", "a/2.txt", "b.txt"}) || aws.ToInt32(out.KeyCount) != 3 ||
		aws.ToBool(out.IsTruncated) || aws.ToInt64(out.Contents[0].Size) != 1 || aws.ToString(out.Contents[0].ETag) == "" ||
		out.Contents[0].LastModified == nil {
		t.Fatalf("list = %v %+v", got, out)
	}
}

// @scenario "A client lists a bucket's keys with ListObjectsV2"
func TestListObjectsV2EmptyBucketAndPrefix(t *testing.T) {
	ts := newTestServer(t)
	client := ts.sdk(devKey)
	out, err := client.ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("langwatch")})
	if err != nil || len(out.Contents) != 0 || aws.ToInt32(out.KeyCount) != 0 {
		t.Fatalf("empty list = %v %+v", err, out)
	}
	putKeys(t, ts, "a/1.txt", "ab.txt", "b.txt")
	out, err = client.ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("langwatch"), Prefix: aws.String("a")})
	if got := listKeys(out); err != nil || !slices.Equal(got, []string{"a/1.txt", "ab.txt"}) {
		t.Fatalf("prefix list = %v %v", err, got)
	}
}

// @scenario "A long listing is paged with a continuation token"
func TestListObjectsV2PagesWithContinuationToken(t *testing.T) {
	ts := newTestServer(t)
	putKeys(t, ts, "k1", "k2", "k3", "k4", "k5")
	client := ts.sdk(devKey)
	first, err := client.ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("langwatch"), MaxKeys: aws.Int32(2)})
	if got := listKeys(first); err != nil || !slices.Equal(got, []string{"k1", "k2"}) || !aws.ToBool(first.IsTruncated) ||
		aws.ToString(first.NextContinuationToken) == "" {
		t.Fatalf("first page = %v %v %+v", err, got, first)
	}
	second, err := client.ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("langwatch"), MaxKeys: aws.Int32(2),
		ContinuationToken: first.NextContinuationToken})
	if got := listKeys(second); err != nil || !slices.Equal(got, []string{"k3", "k4"}) || !aws.ToBool(second.IsTruncated) {
		t.Fatalf("second page = %v %v", err, got)
	}

	var all []string
	pages := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{Bucket: aws.String("langwatch"), MaxKeys: aws.Int32(2)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, listKeys(page)...)
	}
	if !slices.Equal(all, []string{"k1", "k2", "k3", "k4", "k5"}) {
		t.Fatalf("paginated = %v", all)
	}
}

// @scenario "A long listing is paged with a continuation token"
func TestListObjectsV2DelimiterRollsUpCommonPrefixesAcrossPages(t *testing.T) {
	ts := newTestServer(t)
	putKeys(t, ts, "a/1", "a/2", "a/3", "b", "c/1")
	client := ts.sdk(devKey)
	in := &s3.ListObjectsV2Input{Bucket: aws.String("langwatch"), Delimiter: aws.String("/"), MaxKeys: aws.Int32(1)}
	var seen []string
	for pages := s3.NewListObjectsV2Paginator(client, in); pages.HasMorePages(); {
		page, err := pages.NextPage(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		seen = append(seen, listKeys(page)...)
		for _, p := range page.CommonPrefixes {
			seen = append(seen, aws.ToString(p.Prefix))
		}
	}
	if !slices.Equal(seen, []string{"a/", "b", "c/"}) {
		t.Fatalf("delimited pages = %v", seen)
	}
}

// @scenario "A client lists a bucket's keys with ListObjectsV2"
func TestListObjectsV2RefusesBadInput(t *testing.T) {
	ts := newTestServerWith(t, Config{Buckets: []string{"langwatch"}})
	resp, body := doSigned(t, http.MethodGet, ts.URL+"/langwatch?list-type=2&continuation-token=%25%25", nil, nil)
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "InvalidArgument") {
		t.Fatalf("bad token = %d %s", resp.StatusCode, body)
	}
	resp, body = doSigned(t, http.MethodGet, ts.URL+"/langwatch?list-type=2&max-keys=-1", nil, nil)
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(body, "InvalidArgument") {
		t.Fatalf("bad max-keys = %d %s", resp.StatusCode, body)
	}
	_, err := ts.sdk(devKey).ListObjectsV2(t.Context(), &s3.ListObjectsV2Input{Bucket: aws.String("missing")})
	if errorCode(err) != "NoSuchBucket" {
		t.Fatalf("unknown bucket = %v", err)
	}
}
