package idpsim

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// azureAuthorityPath is the shape of an Entra authority URL's path: a tenant
// GUID, then the endpoint. The product's Azure connection is hard-wired to the
// authority host, so these paths are served from the host root.
var azureAuthorityPath = regexp.MustCompile(`^/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(.+)$`)

// azureEndpoints maps an authority endpoint to the per-tenant route serving it.
var azureEndpoints = map[string]string{
	"oauth2/v2.0/authorize":                 "oauth/authorize",
	"oauth2/v2.0/token":                     "oauth/token",
	"discovery/v2.0/keys":                   "oauth/jwks",
	"v2.0/.well-known/openid-configuration": ".well-known/openid-configuration",
}

// guidOf formats the first 16 bytes of sum as a version 4 GUID.
func guidOf(sum []byte) string {
	b := append([]byte(nil), sum[:16]...)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// AzureTenantID is the tenant's Entra directory GUID: the tid claim and the
// path segment of every authority URL, stable per tenant.
func (t *Tenant) AzureTenantID() string {
	h := sha256.Sum256(fmt.Appendf(nil, "idpsim-azure-tenant/%d", t.ID))
	return guidOf(h[:])
}

// azureObjectID is the user's oid claim, the stable account id the product keys on.
func (t *Tenant) azureObjectID(u *User) string {
	h := sha256.Sum256(fmt.Appendf(nil, "idpsim-azure-oid/t%d/%s", t.ID, u.ID))
	return guidOf(h[:])
}

// azureSubject is the pairwise-looking sub: an opaque 43-character base64url string.
func azureSubject(sum [32]byte) string {
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// azureClaims reshapes the shared profile claims into an Entra v2.0 ID token's:
// oid and tid, no email_verified, no name parts, no picture.
func (t *Tenant) azureClaims(claims jwt.MapClaims, u *User, now time.Time) {
	for _, k := range []string{"email_verified", "given_name", "family_name", "nickname", "picture", "groups"} {
		delete(claims, k)
	}
	claims["oid"] = t.azureObjectID(u)
	claims["tid"] = t.AzureTenantID()
	claims["ver"] = "2.0"
	claims["preferred_username"] = u.Email
	claims["nbf"] = now.Unix()
}

// azureDiscovery points a discovery document's endpoints at the authority paths.
func azureDiscovery(t *Tenant, doc map[string]any) {
	authority := t.root() + "/" + t.AzureTenantID()
	doc["authorization_endpoint"] = authority + "/oauth2/v2.0/authorize"
	doc["token_endpoint"] = authority + "/oauth2/v2.0/token"
	doc["jwks_uri"] = authority + "/discovery/v2.0/keys"
	delete(doc, "userinfo_endpoint")
	doc["claims_supported"] = []string{"sub", "oid", "tid", "ver", "email", "name", "preferred_username"}
}

// azureTenant finds the azure-shaped tenant whose directory GUID this is.
func (s *Server) azureTenant(guid string) (*Tenant, bool) {
	for _, t := range s.tenants {
		if t.LegacyProvider() == LegacyProviderAzure && t.AzureTenantID() == guid {
			return t, true
		}
	}
	return nil, false
}

// azureAuthority serves the Entra authority paths from the host root by
// rewriting them onto the tenant's own routes; everything else passes through.
func (s *Server) azureAuthority(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m := azureAuthorityPath.FindStringSubmatch(r.URL.Path); m != nil {
			if t, ok := s.azureTenant(m[1]); ok {
				if route, known := azureEndpoints[m[2]]; known {
					r = r.Clone(r.Context())
					r.URL.Path = "/t/" + strconv.Itoa(t.ID) + "/" + route
					r.URL.RawPath = ""
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// legacyEnvLines are the env lines that point a stack's legacy provider at the tenant.
func (t *Tenant) legacyEnvLines(f LegacyProvider, clientID, secret string) string {
	prefix := providerEnvPrefix[f]
	if f == LegacyProviderAzure {
		return fmt.Sprintf("# azure-ad keeps its authority at https://login.microsoftonline.com: resolve that host to idpsim over https\n"+
			"AUTH_PROVIDER=azure-ad\n%s_CLIENT_ID=%s\n%s_CLIENT_SECRET=%s\n%s_TENANT_ID=%s\n",
			prefix, clientID, prefix, secret, prefix, t.AzureTenantID())
	}
	var b strings.Builder
	if f == LegacyProviderAuth0 {
		b.WriteString("# auth0 keeps only the issuer host and forces https: serve idpsim over https at that host\n")
	}
	fmt.Fprintf(&b, "AUTH_PROVIDER=%s\n%s_CLIENT_ID=%s\n%s_CLIENT_SECRET=%s\n%s_ISSUER=%s\n",
		f, prefix, clientID, prefix, secret, prefix, t.Issuer())
	return b.String()
}
