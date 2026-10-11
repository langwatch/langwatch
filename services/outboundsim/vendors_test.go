package outboundsim

import (
	"net/http"
	"strings"
	"testing"
)

// @scenario "Outboundsim answers the OpenAI, Anthropic and Microsoft calls a pull source makes"
func TestVendorRoutesServeTheGovernancePulls(t *testing.T) {
	g := newRig(t, Config{})
	var members struct {
		Data []map[string]string `json:"data"`
	}
	decode(t, g.get("/openai/v1/organization/users", tokenHeader("sk-admin-good")).body, &members)
	if len(members.Data) != 3 {
		t.Fatalf("openai members = %d, want 3", len(members.Data))
	}
	anthropic := g.get("/anthropic/v1/organizations/me", map[string]string{"x-api-key": "sk-ant-good"})
	if anthropic.status != http.StatusOK || !strings.Contains(anthropic.body, "org_sim") {
		t.Fatalf("anthropic me = %d %s", anthropic.status, anthropic.body)
	}
	token := g.do(http.MethodPost, "/microsoft-login/tenant-1/oauth2/v2.0/token", nil, "client_secret=s3cret")
	if token.status != http.StatusOK || !strings.Contains(token.body, "sim-microsoft-tenant-1") {
		t.Fatalf("microsoft token = %d %s", token.status, token.body)
	}
	for _, path := range []string{"/microsoft-graph/v1.0/users", "/microsoft-graph/v1.0/subscribedSkus"} {
		if got := g.get(path, tokenHeader("sim-microsoft-tenant-1")); got.status != http.StatusOK {
			t.Fatalf("%s = %d %s", path, got.status, got.body)
		}
	}
	if got := g.get("/openai/v1/organization/users", tokenHeader("sk-revoked")); got.status != http.StatusUnauthorized {
		t.Fatalf("revoked key = %d, want 401", got.status)
	}
	if got := g.get("/openai/v1/organization/users", nil); got.status != http.StatusUnauthorized {
		t.Fatalf("no credential = %d, want 401", got.status)
	}
}
