package outboundsim

import (
	"crypto/hmac"
	"crypto/md5" //nolint:gosec // G501: Azure Blob reports Content-MD5; this is the protocol, not a security check
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ChannelAzure records the Azure Blob and managed-identity token calls object storage makes
// when AZURE_BLOB_ENDPOINT points at outboundsim's /azure-blob/{account}.
const ChannelAzure = "azure"

// AzureSimAccounts are the storage accounts outboundsim holds and their dev-only shared keys
// (published like Azurite's; never a real credential). Any other account is refused.
var AzureSimAccounts = map[string]string{
	"simaccount":   base64.StdEncoding.EncodeToString([]byte("outboundsim simaccount shared key, dev only")),
	"otheraccount": base64.StdEncoding.EncodeToString([]byte("outboundsim otheraccount shared key, dev only")),
}

// azureTokenLifetime is how long a managed-identity token lives: six minutes, so the product,
// which renews five minutes before expiry, exchanges again after one.
const azureTokenLifetime = 6 * time.Minute

type azureBlob struct {
	body        []byte
	contentType string
	modified    time.Time
}

// azureStorage is every account's blobs and the bearer tokens issued for them.
type azureStorage struct {
	mu        sync.Mutex
	blobs     map[string]azureBlob
	tokens    map[string]time.Time
	exchanges int
}

func newAzureStorage() *azureStorage {
	return &azureStorage{blobs: map[string]azureBlob{}, tokens: map[string]time.Time{}}
}

func azureError(status int, code, message string) reply {
	return reply{
		status: status, contentType: "application/xml",
		body:   `<?xml version="1.0" encoding="utf-8"?><Error><Code>` + code + `</Code><Message>` + message + `</Message></Error>`,
		header: map[string]string{"x-ms-error-code": code},
	}
}

// azurePath is the part after /azure-blob/{account}: `/{container}` or `/{container}/{blob}`, escaped.
func azurePath(r *http.Request) string {
	rest := strings.TrimPrefix(r.URL.EscapedPath(), "/azure-blob/"+r.PathValue("account"))
	if rest == "" {
		return "/"
	}
	return rest
}

func signAzure(key string, fields []string) string {
	raw, _ := base64.StdEncoding.DecodeString(key)
	mac := hmac.New(sha256.New, raw)
	mac.Write([]byte(strings.Join(fields, "\n")))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// sharedKeyOf is the Shared Key signature of r for a path-style (Azurite-shaped) account.
func sharedKeyOf(r *http.Request, account, key string) string {
	contentLength := ""
	if r.ContentLength > 0 {
		contentLength = strconv.FormatInt(r.ContentLength, 10)
	}
	standard := []string{"Content-Encoding", "Content-Language", "", "Content-MD5", "Content-Type", "Date",
		"If-Modified-Since", "If-Match", "If-None-Match", "If-Unmodified-Since", "Range"}
	fields := []string{r.Method}
	for _, name := range standard {
		if name == "" {
			fields = append(fields, contentLength)
			continue
		}
		fields = append(fields, r.Header.Get(name))
	}
	msHeaders := []string{}
	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-ms-") {
			msHeaders = append(msHeaders, lower+":"+strings.TrimSpace(strings.Join(values, ",")))
		}
	}
	sort.Strings(msHeaders)
	query := []string{}
	for name, values := range r.URL.Query() {
		query = append(query, strings.ToLower(name)+":"+strings.Join(values, ","))
	}
	sort.Strings(query)
	resource := strings.Join(append([]string{"/" + account + "/" + account + azurePath(r)}, query...), "\n")
	return signAzure(key, append(append(fields, msHeaders...), resource))
}

// delegationKeyOf is the user-delegation key outboundsim hands an account's token holders.
func delegationKeyOf(account string) string {
	sum := sha256.Sum256([]byte("outboundsim delegation key " + account))
	return base64.StdEncoding.EncodeToString(sum[:])
}

// sasRefusal checks a blob SAS (service or user-delegation) against the blob, method and clock.
func sasRefusal(r *http.Request, account, key string, now time.Time) (int, string) {
	q := r.URL.Query()
	blob, _ := url.PathUnescape(strings.TrimPrefix(azurePath(r), "/"))
	resource := "/blob/" + account + "/" + blob
	tail := []string{"", "", "", "", "", "", ""}
	var fields []string
	signingKey := key
	if q.Get("skoid") != "" {
		fields = append([]string{q.Get("sp"), q.Get("st"), q.Get("se"), resource, q.Get("skoid"), q.Get("sktid"),
			q.Get("skt"), q.Get("ske"), q.Get("sks"), q.Get("skv"), "", "", "", "", q.Get("spr"), q.Get("sv"), q.Get("sr")}, tail...)
		signingKey = delegationKeyOf(account)
	} else {
		fields = append([]string{q.Get("sp"), q.Get("st"), q.Get("se"), resource, "", "", q.Get("spr"), q.Get("sv"), q.Get("sr")}, tail...)
	}
	if !hmac.Equal([]byte(signAzure(signingKey, fields)), []byte(q.Get("sig"))) {
		return http.StatusForbidden, "AuthenticationFailed"
	}
	if expiry, err := time.Parse(time.RFC3339, q.Get("se")); err != nil || !now.Before(expiry) {
		return http.StatusForbidden, "AuthenticationFailed"
	}
	need := map[string]string{http.MethodPut: "cw", http.MethodGet: "r", http.MethodHead: "r", http.MethodDelete: "d"}[r.Method]
	if need == "" || !strings.ContainsAny(q.Get("sp"), need) {
		return http.StatusForbidden, "AuthorizationPermissionMismatch"
	}
	return 0, ""
}

// azureRefusal authorizes a blob call by SAS, Shared Key or a bearer token this sim issued.
func (s *Server) azureRefusal(r *http.Request) reply {
	account := r.PathValue("account")
	key, known := AzureSimAccounts[account]
	auth := r.Header.Get("Authorization")
	switch {
	case !known:
		return azureError(http.StatusForbidden, "AuthenticationFailed", "Server failed to authenticate the request: no account "+account)
	case r.URL.Query().Get("sig") != "":
		if status, code := sasRefusal(r, account, key, s.now()); status != 0 {
			return azureError(status, code, "The SAS does not authorize this request.")
		}
	case strings.HasPrefix(auth, "SharedKey "):
		name, signature, _ := strings.Cut(strings.TrimPrefix(auth, "SharedKey "), ":")
		if name != account || !hmac.Equal([]byte(signature), []byte(sharedKeyOf(r, account, key))) {
			return azureError(http.StatusForbidden, "AuthenticationFailed", "The MAC signature does not match the account key.")
		}
	case strings.HasPrefix(auth, "Bearer "):
		s.azure.mu.Lock()
		expiry, issued := s.azure.tokens[strings.TrimPrefix(auth, "Bearer ")]
		s.azure.mu.Unlock()
		if !issued || !s.now().Before(expiry) {
			out := azureError(http.StatusUnauthorized, "InvalidAuthenticationInfo", "The token is expired or was not issued here.")
			out.header["WWW-Authenticate"] = "Bearer authorization_uri=https://login.microsoftonline.com/sim/oauth2/authorize resource_id=https://storage.azure.com"
			return out
		}
	default:
		return azureError(http.StatusUnauthorized, "NoAuthenticationInformation", "Server failed to authenticate the request.")
	}
	return reply{}
}

// withCORS lets a browser holding a SAS URL (an upload or a download) read the answer.
func withCORS(r *http.Request, out reply) reply {
	if origin := r.Header.Get("Origin"); origin != "" {
		if out.header == nil {
			out.header = map[string]string{}
		}
		out.header["Access-Control-Allow-Origin"] = origin
		out.header["Access-Control-Expose-Headers"] = "ETag, x-ms-request-id, x-ms-error-code"
	}
	return out
}

// handleAzureBlob serves Put Blob (201), Get Blob (200), Delete Blob (202) and the container
// probe (HEAD ?restype=container, 200) under /azure-blob/{account}.
func (s *Server) handleAzureBlob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("account") + azurePath(r)
	c, ok := readCall(w, r, ChannelAzure, name)
	if !ok {
		return
	}
	c.parsed = map[string]any{"account": r.PathValue("account"), "path": azurePath(r), "sas": r.URL.Query().Get("sig") != ""}
	if refused := s.azureRefusal(r); refused.status != 0 {
		s.finish(w, c, withCORS(r, refused))
		return
	}
	s.finish(w, c, withCORS(r, s.azureAnswer(r, name, c.body)))
}

func (s *Server) azureAnswer(r *http.Request, name string, body []byte) reply {
	s.azure.mu.Lock()
	defer s.azure.mu.Unlock()
	if r.URL.Query().Get("restype") == "container" {
		return reply{status: http.StatusOK, header: map[string]string{"x-ms-request-id": "sim"}}
	}
	held, found := s.azure.blobs[name]
	switch r.Method {
	case http.MethodPut:
		if r.Header.Get("x-ms-blob-type") != "BlockBlob" {
			return azureError(http.StatusBadRequest, "MissingRequiredHeader", "x-ms-blob-type: BlockBlob is required.")
		}
		s.azure.blobs[name] = azureBlob{body: body, contentType: r.Header.Get("Content-Type"), modified: s.now()}
		sum := md5.Sum(body) //nolint:gosec // G401: the Content-MD5 the Azure protocol defines
		return reply{status: http.StatusCreated, header: map[string]string{
			"ETag": fmt.Sprintf(`"0x%X"`, sum[:6]), "Content-MD5": base64.StdEncoding.EncodeToString(sum[:]),
		}}
	case http.MethodDelete:
		if !found {
			return azureError(http.StatusNotFound, "BlobNotFound", "The specified blob does not exist.")
		}
		delete(s.azure.blobs, name)
		return reply{status: http.StatusAccepted}
	}
	if !found {
		return azureError(http.StatusNotFound, "BlobNotFound", "The specified blob does not exist.")
	}
	out := reply{status: http.StatusOK, contentType: held.contentType, header: map[string]string{
		"x-ms-blob-type": "BlockBlob", "Content-Length": strconv.Itoa(len(held.body)),
		"Last-Modified": held.modified.UTC().Format(http.TimeFormat),
	}}
	if r.Method == http.MethodGet {
		out.body = string(held.body)
	}
	return out
}

// handleAzureDelegationKey serves POST /?restype=service&comp=userdelegationkey for a token holder.
func (s *Server) handleAzureDelegationKey(w http.ResponseWriter, r *http.Request) {
	account := r.PathValue("account")
	c, ok := readCall(w, r, ChannelAzure, account+"/userdelegationkey")
	if !ok {
		return
	}
	q := r.URL.Query()
	if q.Get("restype") != "service" || q.Get("comp") != "userdelegationkey" {
		s.finish(w, c, azureError(http.StatusBadRequest, "InvalidQueryParameterValue", "outboundsim fakes comp=userdelegationkey only"))
		return
	}
	if refused := s.azureRefusal(r); refused.status != 0 {
		s.finish(w, c, refused)
		return
	}
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		s.finish(w, c, azureError(http.StatusForbidden, "AuthenticationFailed", "A user-delegation key needs a bearer token."))
		return
	}
	start := s.now().UTC().Format("2006-01-02T15:04:05Z")
	expiry := s.now().UTC().Add(7 * 24 * time.Hour).Format("2006-01-02T15:04:05Z")
	s.finish(w, c, reply{status: http.StatusOK, contentType: "application/xml", body: `<?xml version="1.0" encoding="utf-8"?><UserDelegationKey>` +
		`<SignedOid>00000000-0000-4000-8000-00000000a2e0</SignedOid><SignedTid>00000000-0000-4000-8000-0000000051e0</SignedTid>` +
		`<SignedStart>` + start + `</SignedStart><SignedExpiry>` + expiry + `</SignedExpiry><SignedService>b</SignedService>` +
		`<SignedVersion>2021-12-02</SignedVersion><Value>` + delegationKeyOf(account) + `</Value></UserDelegationKey>`})
}

// handleAzureCORS answers a browser's preflight for a SAS upload or download.
func (s *Server) handleAzureCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
	w.Header().Set("Access-Control-Max-Age", "600")
	w.WriteHeader(http.StatusOK)
}

// handleAzureManagedIdentity is the App Service managed-identity endpoint the Azure SDK calls
// when IDENTITY_ENDPOINT and IDENTITY_HEADER are set: GET ?resource=...&api-version=2019-08-01.
func (s *Server) handleAzureManagedIdentity(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelAzure, "managed-identity")
	if !ok {
		return
	}
	resource := r.URL.Query().Get("resource")
	c.parsed = map[string]any{"resource": resource}
	if r.Header.Get("X-IDENTITY-HEADER") == "" {
		s.finish(w, c, jsonReply(http.StatusBadRequest, map[string]string{"error": "missing X-IDENTITY-HEADER"}))
		return
	}
	if resource == "" {
		s.finish(w, c, jsonReply(http.StatusBadRequest, map[string]string{"error": "resource is required"}))
		return
	}
	expiry := s.now().Add(azureTokenLifetime)
	s.azure.mu.Lock()
	s.azure.exchanges++
	token := fmt.Sprintf("sim-azure-token-%d", s.azure.exchanges)
	s.azure.tokens[token] = expiry
	s.azure.mu.Unlock()
	s.finish(w, c, jsonReply(http.StatusOK, map[string]string{
		"access_token": token, "expires_on": strconv.FormatInt(expiry.Unix(), 10),
		"resource": resource, "token_type": "Bearer",
	}))
}

// handleAzureStatus reports how many token exchanges happened and the blobs held.
func (s *Server) handleAzureStatus(w http.ResponseWriter, _ *http.Request) {
	s.azure.mu.Lock()
	blobs := make([]string, 0, len(s.azure.blobs))
	for name := range s.azure.blobs {
		blobs = append(blobs, name)
	}
	live := 0
	for _, expiry := range s.azure.tokens {
		if s.now().Before(expiry) {
			live++
		}
	}
	exchanges := s.azure.exchanges
	s.azure.mu.Unlock()
	sort.Strings(blobs)
	writeJSON(w, http.StatusOK, map[string]any{"tokenExchanges": exchanges, "liveTokens": live, "blobs": blobs})
}

// handleAzureRevokeTokens expires every issued token, so the next blob call is a 401 and the
// product must exchange again.
func (s *Server) handleAzureRevokeTokens(w http.ResponseWriter, _ *http.Request) {
	s.azure.mu.Lock()
	s.azure.tokens = map[string]time.Time{}
	s.azure.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
