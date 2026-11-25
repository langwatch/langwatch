package outboundsim

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// productSharedKey signs as packages/process-stores/src/object-storage-azure.ts does for a
// path-style endpoint: method, the eleven standard headers, x-ms-* headers, the resource.
func productSharedKey(account, key, method, path string, contentType string, length int, query []string, msHeaders []string) string {
	contentLength := ""
	if length > 0 {
		contentLength = strconv.Itoa(length)
	}
	fields := []string{method, "", "", contentLength, "", contentType, "", "", "", "", "", ""}
	fields = append(fields, msHeaders...)
	resource := strings.Join(append([]string{"/" + account + "/" + account + path}, query...), "\n")
	return "SharedKey " + account + ":" + signAzure(key, append(fields, resource))
}

func blobHeaders(account, key, method, path, contentType string, length int, query []string) map[string]string {
	date := "Fri, 09 Oct 2026 10:00:00 GMT"
	ms := []string{"x-ms-date:" + date, "x-ms-version:2021-12-02"}
	h := map[string]string{"x-ms-date": date, "x-ms-version": "2021-12-02"}
	if method == http.MethodPut {
		ms = []string{"x-ms-blob-type:BlockBlob", "x-ms-date:" + date, "x-ms-version:2021-12-02"}
		h["x-ms-blob-type"] = "BlockBlob"
		h["Content-Type"] = contentType
	}
	h["Authorization"] = productSharedKey(account, key, method, path, contentType, length, query, ms)
	return h
}

// @scenario "Outboundsim holds Azure Blob accounts the object storage writes, reads and deletes"
func TestAzureBlobSharedKeyRoundTrip(t *testing.T) {
	g := newRig(t, Config{})
	key := AzureSimAccounts["simaccount"]
	path := "/langwatch/proj-1/dataset%20one.csv"
	base := "/azure-blob/simaccount"
	if got := g.do(http.MethodHead, base+"/langwatch?restype=container", blobHeaders("simaccount", key, http.MethodHead, "/langwatch", "", 0, []string{"restype:container"}), ""); got.status != http.StatusOK {
		t.Fatalf("container probe = %d", got.status)
	}
	if got := g.do(http.MethodPut, base+path, blobHeaders("simaccount", key, http.MethodPut, path, "text/csv", 7, nil), "a,b\n1,2"); got.status != http.StatusCreated {
		t.Fatalf("put = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodGet, base+path, blobHeaders("simaccount", key, http.MethodGet, path, "", 0, nil), ""); got.status != http.StatusOK || got.body != "a,b\n1,2" {
		t.Fatalf("get = %d %q", got.status, got.body)
	}
	if got := g.do(http.MethodDelete, base+path, blobHeaders("simaccount", key, http.MethodDelete, path, "", 0, nil), ""); got.status != http.StatusAccepted {
		t.Fatalf("delete = %d", got.status)
	}
	if got := g.do(http.MethodGet, base+path, blobHeaders("simaccount", key, http.MethodGet, path, "", 0, nil), ""); got.status != http.StatusNotFound ||
		!strings.Contains(got.body, "BlobNotFound") {
		t.Fatalf("get after delete = %d %s", got.status, got.body)
	}
}

// @scenario "Outboundsim refuses the wrong Azure account and an expired token"
func TestAzureBlobRefusesTheWrongAccountOrKey(t *testing.T) {
	g := newRig(t, Config{})
	path := "/langwatch/a.csv"
	wrongKey := AzureSimAccounts["otheraccount"]
	if got := g.do(http.MethodGet, "/azure-blob/simaccount"+path, blobHeaders("simaccount", wrongKey, http.MethodGet, path, "", 0, nil), ""); got.status != http.StatusForbidden ||
		!strings.Contains(got.body, "AuthenticationFailed") {
		t.Fatalf("wrong key = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodGet, "/azure-blob/nosuchaccount"+path, blobHeaders("nosuchaccount", wrongKey, http.MethodGet, path, "", 0, nil), ""); got.status != http.StatusForbidden {
		t.Fatalf("unknown account = %d", got.status)
	}
	if got := g.do(http.MethodGet, "/azure-blob/simaccount"+path, nil, ""); got.status != http.StatusUnauthorized {
		t.Fatalf("anonymous = %d, want 401", got.status)
	}
}

// @scenario "Outboundsim refuses the wrong Azure account and an expired token"
func TestAzureManagedIdentityTokensExpireAndRefresh(t *testing.T) {
	g := newRig(t, Config{})
	now := g.s.now()
	g.s.now = func() time.Time { return now }
	var token struct {
		AccessToken string `json:"access_token"`
		ExpiresOn   string `json:"expires_on"`
	}
	decode(t, g.do(http.MethodGet, "/azure-msi/token?api-version=2019-08-01&resource=https%3A%2F%2Fstorage.azure.com", map[string]string{"X-IDENTITY-HEADER": "sim"}, "").body, &token)
	bearer := map[string]string{"Authorization": "Bearer " + token.AccessToken, "x-ms-blob-type": "BlockBlob"}
	if got := g.do(http.MethodPut, "/azure-blob/simaccount/langwatch/b.csv", bearer, "x"); got.status != http.StatusCreated {
		t.Fatalf("bearer put = %d %s", got.status, got.body)
	}
	g.s.now = func() time.Time { return now.Add(azureTokenLifetime) }
	if got := g.do(http.MethodGet, "/azure-blob/simaccount/langwatch/b.csv", bearer, ""); got.status != http.StatusUnauthorized ||
		!strings.Contains(got.body, "InvalidAuthenticationInfo") {
		t.Fatalf("expired token = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodGet, "/azure-msi/token?resource=x", nil, ""); got.status != http.StatusBadRequest {
		t.Fatalf("no identity header = %d", got.status)
	}
	var status struct {
		TokenExchanges int `json:"tokenExchanges"`
	}
	decode(t, g.do(http.MethodGet, "/_sim/api/azure", nil, "").body, &status)
	if status.TokenExchanges != 1 {
		t.Fatalf("exchanges = %d", status.TokenExchanges)
	}
}

// @scenario "Outboundsim holds Azure Blob accounts the object storage writes, reads and deletes"
func TestAzureBlobSASUploadFromABrowser(t *testing.T) {
	g := newRig(t, Config{})
	key := AzureSimAccounts["simaccount"]
	expiry := g.s.now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05Z")
	sign := func(perms string) string {
		fields := []string{perms, "", expiry, "/blob/simaccount/langwatch/up.csv", "", "", "https,http", "2021-12-02", "b", "", "", "", "", "", "", ""}
		q := url.Values{"sv": {"2021-12-02"}, "sr": {"b"}, "sp": {perms}, "se": {expiry}, "spr": {"https,http"}, "sig": {signAzure(key, fields)}}
		return "/azure-blob/simaccount/langwatch/up.csv?" + q.Encode()
	}
	preflight := g.do(http.MethodOptions, "/azure-blob/simaccount/langwatch/up.csv", map[string]string{
		"Origin": "https://app.test", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-ms-blob-type",
	}, "")
	if preflight.header.Get("Access-Control-Allow-Origin") != "https://app.test" {
		t.Fatalf("preflight = %d %v", preflight.status, preflight.header)
	}
	put := g.do(http.MethodPut, sign("cw"), map[string]string{"Origin": "https://app.test", "x-ms-blob-type": "BlockBlob", "Content-Type": "text/csv"}, "a\n1")
	if put.status != http.StatusCreated || put.header.Get("Access-Control-Allow-Origin") != "https://app.test" {
		t.Fatalf("sas put = %d %s", put.status, put.body)
	}
	if got := g.do(http.MethodGet, sign("cw"), nil, ""); got.status != http.StatusForbidden {
		t.Fatalf("read with an upload SAS = %d, want 403", got.status)
	}
	if got := g.do(http.MethodGet, sign("r"), nil, ""); got.status != http.StatusOK || got.body != "a\n1" {
		t.Fatalf("sas get = %d %q", got.status, got.body)
	}
}
