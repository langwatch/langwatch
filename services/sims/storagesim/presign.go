package storagesim

import (
	"cmp"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// presignRegion is the region minted URLs are scoped to; storagesim accepts any.
const presignRegion = "us-east-1"

// presignDefaultExpiry is how long a minted URL lives when ?expires= is absent.
const presignDefaultExpiry = 3600

// presignRequest is one URL to mint: method on obj, valid for expires seconds, signed for
// the host the caller reached storagesim on.
type presignRequest struct {
	method, origin, host string
	obj                  object
	expires              int
}

// presign answers the query-signed URL for req and when it stops working.
func (s *Server) presign(req presignRequest) (string, time.Time) {
	method, host, obj, expires := req.method, req.host, req.obj, req.expires
	now := s.now().UTC()
	amzDate := now.Format(amzDateLayout)
	scope := amzDate[:8] + "/" + presignRegion + "/s3/aws4_request"
	query := url.Values{
		"X-Amz-Algorithm":     {sigV4Algorithm},
		"X-Amz-Credential":    {s.cfg.AccessKeyID + "/" + scope},
		"X-Amz-Date":          {amzDate},
		"X-Amz-Expires":       {strconv.Itoa(expires)},
		"X-Amz-SignedHeaders": {"host"},
	}.Encode()
	path := awsEscape("/"+obj.bucket+"/"+obj.key, false)
	canonical := strings.Join([]string{
		method, path, canonicalQuery(query, true), "host:" + host + "\n", "host", unsignedPayload,
	}, "\n")
	stringToSign := strings.Join([]string{sigV4Algorithm, amzDate, scope, sha256Hex(canonical)}, "\n")
	signature := s.sign(amzDate[:8], presignRegion, stringToSign)
	return req.origin + path + "?" + query + "&X-Amz-Signature=" + signature, now.Add(time.Duration(expires) * time.Second)
}

// handlePresign mints a presigned GET or PUT URL for ?bucket=&key=, as an SDK would.
func (s *Server) handlePresign(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	obj := object{bucket: q.Get("bucket"), key: q.Get("key")}
	if e := validate(obj); obj.key == "" || e != nil {
		writeAPIError(w, http.StatusBadRequest, "a valid bucket and key are required")
		return
	}
	method := cmp.Or(q.Get("method"), http.MethodGet)
	if method != http.MethodGet && method != http.MethodPut {
		writeAPIError(w, http.StatusBadRequest, "method must be GET or PUT")
		return
	}
	expires := presignDefaultExpiry
	if raw := q.Get("expires"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxPresignExpiry {
			writeAPIError(w, http.StatusBadRequest, "expires must be between 1 and 604800 seconds")
			return
		}
		expires = n
	}
	scheme := cmp.Or(r.Header.Get("X-Forwarded-Proto"), "http")
	if r.TLS != nil {
		scheme = "https"
	}
	signed, expiresAt := s.presign(presignRequest{
		method: method, origin: scheme + "://" + r.Host, host: r.Host, obj: obj, expires: expires,
	})
	writeJSON(w, http.StatusOK, map[string]any{"url": signed, "method": method, "expiresAt": expiresAt})
}

// handleSeed writes the demo objects on a POST, leaving existing ones untouched.
func (s *Server) handleSeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAPIError(w, http.StatusMethodNotAllowed, "seed is a POST")
		return
	}
	if err := s.seed(); err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"seeded": len(seedObjects)})
}
