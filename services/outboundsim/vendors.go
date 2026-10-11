package outboundsim

import (
	"net/http"
	"strings"
)

// ChannelVendor records the OpenAI, Anthropic and Microsoft calls governance pull sources make
// when their vendor base points at this sim.
const ChannelVendor = "vendor"

// vendorUsers is the member list every vendor route serves; Microsoft needs UUID ids.
var vendorUsers = []map[string]string{
	{"id": "11111111-1111-4111-8111-111111111111", "name": "Ada Analyst", "email": "ada@sim.vendor.test"},
	{"id": "22222222-2222-4222-8222-222222222222", "name": "Ben Builder", "email": "ben@sim.vendor.test"},
	{"id": "33333333-3333-4333-8333-333333333333", "name": "Cleo Controller", "email": "cleo@sim.vendor.test"},
}

// vendorCall answers a vendor route: the bearer or x-api-key word picks the tenant as on the
// Databricks routes (empty, revoked, noscope, ratelimited, down, malformed).
func (s *Server) vendorCall(w http.ResponseWriter, r *http.Request, answer func(tenant string) reply) {
	c, ok := readCall(w, r, ChannelVendor, r.URL.Path)
	if !ok {
		return
	}
	credential := bearerOf(r)
	if credential == "" {
		credential = r.Header.Get("x-api-key")
	}
	if credential == "" {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "missing credential"}))
		return
	}
	tenant := dbxTenantOf(credential)
	if refusal, refused := dbxRefusal(tenant); refused {
		s.finish(w, c, refusal)
		return
	}
	s.finish(w, c, answer(tenant))
}

func (s *Server) handleVendorMembers(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		data := vendorUsers
		if tenant == dbxTenantEmpty {
			data = []map[string]string{}
		}
		return jsonReply(http.StatusOK, map[string]any{"data": data, "has_more": false, "last_id": nil})
	})
}

func (s *Server) handleOpenAIProjects(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		out := jsonReply(http.StatusOK, map[string]any{"data": []map[string]string{{"id": "proj_sim"}}})
		out.header = map[string]string{"openai-organization": "org-sim"}
		return out
	})
}

func (s *Server) handleAnthropicMe(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		return jsonReply(http.StatusOK, map[string]string{"id": "org_sim", "name": "Sim organisation"})
	})
}

// handleMicrosoftToken answers any tenant's client-credentials grant; a tenant word in the
// client secret (revoked, down, ...) refuses it as the Databricks token route does.
func (s *Server) handleMicrosoftToken(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelVendor, r.URL.Path)
	if !ok {
		return
	}
	secret := strings.ToLower(string(c.body))
	if tenant := dbxTenantOf(secret); tenant == dbxTenantRevoked || tenant == dbxTenantNoScope {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]string{"error": "invalid_client"}))
		return
	}
	s.finish(w, c, jsonReply(http.StatusOK, map[string]any{
		"access_token": "sim-microsoft-" + r.PathValue("tenant"), "token_type": "Bearer", "expires_in": 3600,
	}))
}

func (s *Server) handleGraphUsers(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(tenant string) reply {
		rows := []map[string]any{}
		if tenant != dbxTenantEmpty {
			for _, u := range vendorUsers {
				rows = append(rows, map[string]any{
					"id": u["id"], "displayName": u["name"], "mail": u["email"],
					"userPrincipalName": u["email"], "department": "Engineering", "accountEnabled": true,
				})
			}
		}
		return jsonReply(http.StatusOK, map[string]any{"value": rows})
	})
}

func (s *Server) handleGraphSkus(w http.ResponseWriter, r *http.Request) {
	s.vendorCall(w, r, func(string) reply {
		return jsonReply(http.StatusOK, map[string]any{"value": []map[string]any{{
			"skuId": "44444444-4444-4444-8444-444444444444", "skuPartNumber": "COPILOT_STUDIO_SIM",
			"appliesTo": "User", "capabilityStatus": "Enabled", "consumedUnits": 2,
			"prepaidUnits": map[string]int{"enabled": 5, "suspended": 0, "warning": 0},
		}}})
	})
}
