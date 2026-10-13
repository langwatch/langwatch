package snapshot

import (
	"cmp"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Credentials sign S3 requests. Nothing in this package prints them or the signature they make.
type Credentials struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
}

const (
	sigV4Algorithm = "AWS4-HMAC-SHA256"
	amzDateLayout  = "20060102T150405Z"
)

// unreservedBytes are the bytes SigV4 never escapes.
const unreservedBytes = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"

var errNoCredentials = errors.New("no S3 credentials to sign with (set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)")

// sigV4 is AWS Signature Version 4 for one region and service, sent in the Authorization header.
type sigV4 struct {
	credentials     Credentials
	region, service string
}

// sign sets X-Amz-Date and Authorization. It signs host and every x-amz-* header; the payload
// hash is X-Amz-Content-Sha256, or the empty body's when that header is absent.
func (signer sigV4) sign(request *http.Request, now time.Time) error {
	if signer.credentials.AccessKeyID == "" || signer.credentials.SecretAccessKey == "" {
		return errNoCredentials
	}
	amzDate := now.UTC().Format(amzDateLayout)
	request.Header.Set("X-Amz-Date", amzDate)
	if signer.credentials.SessionToken != "" {
		request.Header.Set("X-Amz-Security-Token", signer.credentials.SessionToken)
	}
	scope := []string{amzDate[:8], signer.region, signer.service, "aws4_request"}
	canonical, signedHeaders := canonicalRequest(request)
	stringToSign := strings.Join([]string{sigV4Algorithm, amzDate, strings.Join(scope, "/"), hexSHA256([]byte(canonical))}, "\n")
	key := []byte("AWS4" + signer.credentials.SecretAccessKey)
	for _, part := range scope {
		key = hmacSHA256(key, part)
	}
	request.Header.Set("Authorization", fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		sigV4Algorithm, signer.credentials.AccessKeyID, strings.Join(scope, "/"), signedHeaders, hex.EncodeToString(hmacSHA256(key, stringToSign))))
	return nil
}

// canonicalRequest is SigV4's canonical form; S3 encodes the path once.
func canonicalRequest(request *http.Request) (canonical, signedHeaders string) {
	names, headers := canonicalHeaders(request)
	payload := cmp.Or(request.Header.Get("X-Amz-Content-Sha256"), hexSHA256(nil))
	path := cmp.Or(request.URL.Path, "/")
	signedHeaders = strings.Join(names, ";")
	canonical = strings.Join([]string{request.Method, awsEscape(path, false), canonicalQuery(request.URL.Query()), headers, signedHeaders, payload}, "\n")
	return canonical, signedHeaders
}

func canonicalHeaders(request *http.Request) ([]string, string) {
	values := map[string]string{"host": cmp.Or(request.Host, request.URL.Host)}
	for name, list := range request.Header {
		lower := strings.ToLower(name)
		if !strings.HasPrefix(lower, "x-amz-") {
			continue
		}
		trimmed := make([]string, 0, len(list))
		for _, value := range list {
			trimmed = append(trimmed, strings.Join(strings.Fields(value), " "))
		}
		values[lower] = strings.Join(trimmed, ",")
	}
	names := slices.Sorted(maps.Keys(values))
	var block strings.Builder
	for _, name := range names {
		block.WriteString(name + ":" + values[name] + "\n")
	}
	return names, block.String()
}

// canonicalQuery is every pair escaped and sorted by name, then value. The client sends this exact string.
func canonicalQuery(query url.Values) string {
	pairs := make([][2]string, 0, len(query))
	for name, list := range query {
		for _, value := range list {
			pairs = append(pairs, [2]string{awsEscape(name, true), awsEscape(value, true)})
		}
	}
	slices.SortFunc(pairs, func(a, b [2]string) int {
		return cmp.Or(strings.Compare(a[0], b[0]), strings.Compare(a[1], b[1]))
	})
	joined := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		joined = append(joined, pair[0]+"="+pair[1])
	}
	return strings.Join(joined, "&")
}

// awsEscape is SigV4's URI encoding: every byte but A-Z a-z 0-9 - _ . ~ becomes %XX, and so does
// '/' unless it separates a path.
func awsEscape(text string, encodeSlash bool) string {
	var escaped strings.Builder
	for i := range len(text) {
		char := text[i]
		if strings.IndexByte(unreservedBytes, char) >= 0 || (char == '/' && !encodeSlash) {
			escaped.WriteByte(char)
			continue
		}
		fmt.Fprintf(&escaped, "%%%02X", char)
	}
	return escaped.String()
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func hexSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
