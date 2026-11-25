package snapshot

import (
	"bytes"
	"cmp"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const s3URLForm = "-objects wants http(s)://host[:port]/<bucket>[?region=R&addressing=path|virtual]"

// S3 is an Objects bucket over the S3 REST API, signed with SigV4: MinIO, storagesim or AWS.
type S3 struct {
	endpoint    url.URL
	bucket      string
	virtualHost bool
	signer      sigV4
	client      *http.Client
}

// NewS3 reads http(s)://host[:port]/<bucket>[?region=R&addressing=virtual]; path-style and
// us-east-1 are the defaults. Credentials come from the caller, never from the URL.
func NewS3(raw string, credentials Credentials) (*S3, error) {
	endpoint, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New(s3URLForm)
	}
	if endpoint.User != nil {
		return nil, errors.New("-objects takes no credentials in the URL; set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")
	}
	bucket := strings.Trim(endpoint.Path, "/")
	options := endpoint.Query()
	addressing := options.Get("addressing")
	valid := (endpoint.Scheme == "http" || endpoint.Scheme == "https") && endpoint.Host != "" && bucket != "" && !strings.Contains(bucket, "/")
	if !valid || (addressing != "" && addressing != "path" && addressing != "virtual") {
		return nil, errors.New(s3URLForm)
	}
	return &S3{
		endpoint:    url.URL{Scheme: endpoint.Scheme, Host: endpoint.Host},
		bucket:      bucket,
		virtualHost: addressing == "virtual",
		signer:      sigV4{credentials: credentials, region: cmp.Or(options.Get("region"), "us-east-1"), service: "s3"},
		client:      http.DefaultClient,
	}, nil
}

// Bucket is the bucket name the restore guard checks.
func (store *S3) Bucket() string { return store.bucket }

// CheckBucket is HeadBucket: it proves the endpoint, the bucket and the credentials before any work.
func (store *S3) CheckBucket(ctx context.Context) error {
	_, err := store.do(ctx, s3Call{method: http.MethodHead})
	return err
}

// Get is GetObject.
func (store *S3) Get(ctx context.Context, key string) ([]byte, error) {
	return store.do(ctx, s3Call{method: http.MethodGet, key: key})
}

// Put is PutObject.
func (store *S3) Put(ctx context.Context, object Object) error {
	_, err := store.do(ctx, s3Call{method: http.MethodPut, key: object.Key, body: object.Body})
	return err
}

// List is ListObjectsV2 over the whole bucket, following NextContinuationToken to the end.
func (store *S3) List(ctx context.Context) ([]string, error) {
	var keys []string
	token := ""
	for {
		page, err := store.listPage(ctx, token)
		if err != nil {
			return nil, err
		}
		for _, entry := range page.Contents {
			keys = append(keys, entry.Key)
		}
		if !page.IsTruncated {
			return keys, nil
		}
		if page.NextContinuationToken == "" || page.NextContinuationToken == token {
			return nil, fmt.Errorf("s3 list %s: a truncated page carries no new continuation token", store.bucket)
		}
		token = page.NextContinuationToken
	}
}

type listPage struct {
	Contents              []struct{ Key string }
	IsTruncated           bool
	NextContinuationToken string
}

func (store *S3) listPage(ctx context.Context, token string) (listPage, error) {
	query := url.Values{"list-type": {"2"}}
	if token != "" {
		query.Set("continuation-token", token)
	}
	body, err := store.do(ctx, s3Call{method: http.MethodGet, query: query})
	if err != nil {
		return listPage{}, err
	}
	var page listPage
	err = xml.Unmarshal(body, &page)
	if err != nil {
		return listPage{}, fmt.Errorf("s3 list %s: %w", store.bucket, err)
	}
	return page, nil
}

// s3Call is one request: no key addresses the bucket itself.
type s3Call struct {
	method string
	key    string
	query  url.Values
	body   []byte
}

func (store *S3) do(ctx context.Context, call s3Call) ([]byte, error) {
	request, err := store.request(ctx, call)
	if err != nil {
		return nil, store.fail(call, err)
	}
	response, err := store.client.Do(request)
	if err != nil {
		return nil, store.fail(call, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, store.fail(call, err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, store.fail(call, &S3Error{Status: response.StatusCode, Code: errorCode(body)})
	}
	return body, nil
}

// request sends the path and query exactly as they were signed.
func (store *S3) request(ctx context.Context, call s3Call) (*http.Request, error) {
	target := store.endpoint
	target.Path = "/" + store.bucket
	if call.key != "" {
		target.Path += "/" + call.key
	}
	if store.virtualHost {
		target.Host = store.bucket + "." + target.Host
		target.Path = "/" + call.key
	}
	target.RawPath = awsEscape(target.Path, false)
	target.RawQuery = canonicalQuery(call.query)
	request, err := http.NewRequestWithContext(ctx, call.method, target.String(), bytes.NewReader(call.body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Amz-Content-Sha256", hexSHA256(call.body))
	err = store.signer.sign(request, time.Now())
	if err != nil {
		return nil, err
	}
	return request, nil
}

// fail names the bucket and key; the cause never carries a header or a response body.
func (store *S3) fail(call s3Call, cause error) error {
	return fmt.Errorf("s3 %s %s/%s: %w", call.method, store.bucket, call.key, cause)
}

// S3Error is a non-2xx answer, reduced to its status and S3 error code: an S3 error body can
// echo the access key, the string to sign and the signature.
type S3Error struct {
	Status int
	Code   string
}

func (failure *S3Error) Error() string {
	return fmt.Sprintf("%d %s", failure.Status, cmp.Or(failure.Code, http.StatusText(failure.Status)))
}

var s3ErrorCode = regexp.MustCompile(`<Code>([A-Za-z]{1,64})</Code>`)

func errorCode(body []byte) string {
	match := s3ErrorCode.FindSubmatch(body)
	if match == nil {
		return ""
	}
	return string(match[1])
}
