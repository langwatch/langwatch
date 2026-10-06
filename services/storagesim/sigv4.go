package storagesim

import (
	"cmp"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	sigV4Algorithm  = "AWS4-HMAC-SHA256"
	amzDateLayout   = "20060102T150405Z"
	unsignedPayload = "UNSIGNED-PAYLOAD"
	// maxClockSkew is how far a header-signed request's X-Amz-Date may drift, as on S3.
	maxClockSkew = 15 * time.Minute
	// maxPresignExpiry is S3's seven-day ceiling on X-Amz-Expires.
	maxPresignExpiry = 7 * 24 * 60 * 60
)

// sigV4Request is one request's SigV4 claims, from its Authorization header or its query.
type sigV4Request struct {
	presigned     bool
	accessKey     string
	scope         string // date/region/service/aws4_request
	date          string // yyyymmdd from the scope
	region        string
	amzDate       time.Time
	amzDateRaw    string
	signedHeaders []string
	signature     string
	payloadHash   string
}

// checkRequestTime refuses a presigned URL past its expiry or not yet valid, and
// a header-signed request whose clock is too far from the server's.
func (s *Server) checkRequestTime(r *http.Request, claims sigV4Request, obj object) *s3Error {
	now := s.now().UTC()
	if !claims.presigned {
		if skew := now.Sub(claims.amzDate); skew > maxClockSkew || skew < -maxClockSkew {
			e := obj.fail(http.StatusForbidden, "RequestTimeTooSkewed",
				"The difference between the request time and the current time is too large.")
			e.RequestTime, e.ServerTime = claims.amzDateRaw, now.Format(time.RFC3339)
			return &e
		}
		return nil
	}
	expires, _ := strconv.Atoi(r.URL.Query().Get("X-Amz-Expires"))
	if deadline := claims.amzDate.Add(time.Duration(expires) * time.Second); now.After(deadline) {
		e := obj.fail(http.StatusForbidden, "AccessDenied", "Request has expired")
		e.Expires, e.ServerTime = deadline.Format(time.RFC3339), now.Format(time.RFC3339)
		e.XAmzExpires = strconv.Itoa(expires)
		return &e
	}
	if claims.amzDate.After(now.Add(maxClockSkew)) {
		e := obj.fail(http.StatusForbidden, "AccessDenied", "Request is not yet valid")
		return &e
	}
	return nil
}

// authenticate checks r's SigV4 signature against the dev key the way S3
// does: header or presigned-query auth, the credential scope, the clock or
// the expiry, then the signature itself. It answers the S3 error or nil.
func (s *Server) authenticate(r *http.Request, obj object) *s3Error {
	claims, fail := parseSigV4(r, obj)
	if fail != nil {
		return fail
	}
	if e := s.checkRequestTime(r, claims, obj); e != nil {
		return e
	}
	if claims.accessKey != s.cfg.AccessKeyID {
		e := obj.fail(http.StatusForbidden, "InvalidAccessKeyId",
			"The AWS Access Key Id you provided does not exist in our records.")
		e.AWSAccessKeyID = claims.accessKey
		return &e
	}
	canonical := canonicalRequest(r, claims)
	stringToSign := strings.Join([]string{sigV4Algorithm, claims.amzDateRaw, claims.scope, sha256Hex(canonical)}, "\n")
	key := hmacSHA256([]byte("AWS4"+s.cfg.SecretAccessKey), claims.date)
	for _, part := range []string{claims.region, "s3", "aws4_request"} {
		key = hmacSHA256(key, part)
	}
	want := hex.EncodeToString(hmacSHA256(key, stringToSign))
	if !hmac.Equal([]byte(want), []byte(strings.ToLower(claims.signature))) {
		e := obj.fail(http.StatusForbidden, "SignatureDoesNotMatch",
			"The request signature we calculated does not match the signature you provided. Check your key and signing method.")
		e.AWSAccessKeyID, e.StringToSign, e.SignatureProvided, e.CanonicalRequest =
			claims.accessKey, stringToSign, claims.signature, canonical
		return &e
	}
	return nil
}

// parseSigV4 reads the claims, refusing an anonymous or malformed request as S3 does.
func parseSigV4(r *http.Request, obj object) (sigV4Request, *s3Error) {
	q := r.URL.Query()
	if q.Has("X-Amz-Algorithm") || q.Has("X-Amz-Signature") || q.Has("X-Amz-Credential") {
		return parsePresigned(q, obj)
	}
	auth := r.Header.Get("Authorization")
	if auth == "" {
		e := obj.fail(http.StatusForbidden, "AccessDenied", "Access Denied")
		return sigV4Request{}, &e
	}
	malformed := func(msg string) (sigV4Request, *s3Error) {
		e := obj.fail(http.StatusBadRequest, "AuthorizationHeaderMalformed", msg)
		return sigV4Request{}, &e
	}
	rest, ok := strings.CutPrefix(auth, sigV4Algorithm+" ")
	if !ok {
		e := obj.fail(http.StatusBadRequest, "InvalidRequest",
			"The authorization mechanism you have provided is not supported. Please use AWS4-HMAC-SHA256.")
		return sigV4Request{}, &e
	}
	fields := map[string]string{}
	for part := range strings.SplitSeq(rest, ",") {
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		fields[k] = v
	}
	c := sigV4Request{signedHeaders: strings.Split(fields["SignedHeaders"], ";"), signature: fields["Signature"]}
	c.amzDateRaw = r.Header.Get("X-Amz-Date")
	c.payloadHash = r.Header.Get("X-Amz-Content-Sha256")
	if c.payloadHash == "" {
		e := obj.fail(http.StatusBadRequest, "InvalidRequest", "Missing required header for this request: x-amz-content-sha256")
		return sigV4Request{}, &e
	}
	if msg := c.readScope(fields["Credential"]); msg != "" {
		return malformed(msg)
	}
	return c, nil
}

func parsePresigned(q url.Values, obj object) (sigV4Request, *s3Error) {
	malformed := func(msg string) (sigV4Request, *s3Error) {
		e := obj.fail(http.StatusBadRequest, "AuthorizationQueryParametersError", msg)
		return sigV4Request{}, &e
	}
	if q.Get("X-Amz-Algorithm") != sigV4Algorithm {
		return malformed("X-Amz-Algorithm only supports \"AWS4-HMAC-SHA256\"")
	}
	for _, name := range []string{"X-Amz-Credential", "X-Amz-Signature", "X-Amz-Date", "X-Amz-SignedHeaders", "X-Amz-Expires"} {
		if q.Get(name) == "" {
			return malformed("Query-string authentication version 4 requires the X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, X-Amz-Date, X-Amz-SignedHeaders, and X-Amz-Expires parameters.")
		}
	}
	if expires, err := strconv.Atoi(q.Get("X-Amz-Expires")); err != nil || expires < 1 || expires > maxPresignExpiry {
		return malformed("X-Amz-Expires must be between 1 and 604800 seconds")
	}
	c := sigV4Request{
		presigned:     true,
		signedHeaders: strings.Split(q.Get("X-Amz-SignedHeaders"), ";"),
		signature:     q.Get("X-Amz-Signature"),
		amzDateRaw:    q.Get("X-Amz-Date"),
		payloadHash:   cmp.Or(q.Get("X-Amz-Content-Sha256"), unsignedPayload),
	}
	if msg := c.readScope(q.Get("X-Amz-Credential")); msg != "" {
		return malformed(msg)
	}
	return c, nil
}

// readScope fills the key, scope and date from a Credential; a non-empty answer is the refusal.
func (c *sigV4Request) readScope(credential string) string {
	parts := strings.Split(credential, "/")
	if len(parts) != 5 || parts[3] != "s3" || parts[4] != "aws4_request" {
		return fmt.Sprintf("Error parsing the X-Amz-Credential parameter; the Credential is mal-formed; expecting \"<YOUR-AKID>/YYYYMMDD/REGION/SERVICE/aws4_request\". %q", credential)
	}
	amzDate, err := time.Parse(amzDateLayout, c.amzDateRaw)
	if err != nil || parts[1] != c.amzDateRaw[:8] {
		return "X-Amz-Date must be in the ISO8601 Long Format \"yyyyMMdd'T'HHmmss'Z'\" and match the credential date"
	}
	if !slices.Contains(c.signedHeaders, "host") {
		return "SignedHeaders must include host"
	}
	c.accessKey, c.date, c.region, c.scope, c.amzDate = parts[0], parts[1], parts[2], strings.Join(parts[1:], "/"), amzDate
	return ""
}

// canonicalRequest is SigV4's canonical form of r; S3 encodes the path once.
func canonicalRequest(r *http.Request, c sigV4Request) string {
	var headers strings.Builder
	for _, name := range c.signedHeaders {
		headers.WriteString(name + ":" + headerValue(r, name) + "\n")
	}
	return strings.Join([]string{
		r.Method, awsEscape(r.URL.Path, false), canonicalQuery(r.URL.RawQuery, c.presigned),
		headers.String(), strings.Join(c.signedHeaders, ";"), c.payloadHash,
	}, "\n")
}

func headerValue(r *http.Request, name string) string {
	switch name {
	case "host":
		return r.Host
	case "content-length":
		if r.Header.Get("Content-Length") == "" && r.ContentLength >= 0 {
			return strconv.FormatInt(r.ContentLength, 10)
		}
	}
	values := r.Header.Values(name)
	for i, v := range values {
		values[i] = strings.Join(strings.Fields(v), " ")
	}
	return strings.Join(values, ",")
}

// canonicalQuery re-encodes every pair but the signature itself, sorted. A
// '+' stays a '+': SigV4 clients send a space as %20.
func canonicalQuery(raw string, presigned bool) string {
	var pairs []string
	for pair := range strings.SplitSeq(raw, "&") {
		if pair == "" {
			continue
		}
		k, v, _ := strings.Cut(pair, "=")
		k, _ = url.PathUnescape(k)
		v, _ = url.PathUnescape(v)
		if presigned && k == "X-Amz-Signature" {
			continue
		}
		pairs = append(pairs, awsEscape(k, true)+"="+awsEscape(v, true))
	}
	slices.Sort(pairs)
	return strings.Join(pairs, "&")
}

// awsEscape is SigV4's URI encoding: every byte but A-Z a-z 0-9 - _ . ~ is
// %XX, and '/' too unless it separates a path.
func awsEscape(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := range len(s) {
		c := s[i]
		switch {
		case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
