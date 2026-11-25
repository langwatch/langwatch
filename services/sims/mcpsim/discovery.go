package mcpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// metadata is what discovery found.
type metadata struct {
	resource, authorizationEndpoint, tokenEndpoint, registrationEndpoint string
}

var resourceMetadataParam = regexp.MustCompile(`resource_metadata="([^"]+)"`)

// discover finds the authorization server the way an MCP client does: an
// unauthenticated initialize for the 401 challenge, the protected-resource
// document (path-suffixed first, RFC 9728), then the authorization server's (RFC 8414).
func (a *oauthAttempt) discover(ctx context.Context) error {
	issuer, err := a.protectedResource(ctx, a.challenge(ctx))
	if err != nil {
		return err
	}
	return a.authorizationServer(ctx, issuer)
}

// challenge is the WWW-Authenticate an unauthenticated initialize answers.
func (a *oauthAttempt) challenge(ctx context.Context) string {
	endpoint := a.req.Endpoint
	initBody := `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcpsim","version":"1"}}}`
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: endpoint + "/mcp", body: strings.NewReader(initBody), headers: map[string]string{
		contentType: applicationJSON, "Accept": "application/json, text/event-stream",
	}})
	challenge := ""
	if x.header != nil {
		challenge = x.header.Get("WWW-Authenticate")
	}
	ok := x.status == http.StatusUnauthorized && strings.Contains(challenge, "resource_metadata=")
	a.rn.httpStep(Step{Kind: "challenge", Flow: FlowOAuth, Transport: "/mcp", Method: http.MethodPost, URL: endpoint + "/mcp", OK: ok,
		Detail: "unauthenticated initialize; WWW-Authenticate: " + firstOf(challenge, "(none)")}, x)
	a.rn.check("unauthenticated initialize answers 401 with a resource_metadata challenge", ok, fmt.Sprintf("%d %s", x.status, challenge))
	return challenge
}

// protectedResource reads the protected-resource document and answers its authorization server.
func (a *oauthAttempt) protectedResource(ctx context.Context, challenge string) (string, error) {
	var prm struct {
		Resource             string   `json:"resource"`
		AuthorizationServers []string `json:"authorization_servers"`
	}
	candidates := []string{a.req.Endpoint + "/.well-known/oauth-protected-resource/mcp"}
	if m := resourceMetadataParam.FindStringSubmatch(challenge); m != nil {
		candidates = append(candidates, m[1])
	}
	found := false
	for _, u := range candidates {
		x := a.s.getJSON(ctx, u)
		found = x.status == http.StatusOK && json.Unmarshal(x.body, &prm) == nil && len(prm.AuthorizationServers) > 0
		a.rn.httpStep(Step{Kind: "discover", Flow: FlowOAuth, Method: http.MethodGet, URL: u, OK: found, Detail: "protected-resource metadata"}, x)
		if found {
			break
		}
	}
	a.rn.check("protected-resource metadata names an authorization server", found, strings.Join(prm.AuthorizationServers, ", "))
	if !found {
		return "", errors.New("no protected-resource metadata with an authorization server")
	}
	a.md.resource = prm.Resource
	return strings.TrimRight(prm.AuthorizationServers[0], "/"), nil
}

func (a *oauthAttempt) authorizationServer(ctx context.Context, issuer string) error {
	var asm struct {
		AuthorizationEndpoint string   `json:"authorization_endpoint"`
		TokenEndpoint         string   `json:"token_endpoint"`
		RegistrationEndpoint  string   `json:"registration_endpoint"`
		Methods               []string `json:"code_challenge_methods_supported"`
	}
	asURL := wellKnown(issuer, "oauth-authorization-server")
	x := a.s.getJSON(ctx, asURL)
	good := x.status == http.StatusOK && json.Unmarshal(x.body, &asm) == nil &&
		asm.TokenEndpoint != "" && asm.AuthorizationEndpoint != "" && asm.RegistrationEndpoint != ""
	a.rn.httpStep(Step{Kind: "discover", Flow: FlowOAuth, Method: http.MethodGet, URL: asURL, OK: good, Detail: "authorization-server metadata"}, x)
	a.rn.check("authorization-server metadata has the endpoints and PKCE S256", good && contains(asm.Methods, "S256"),
		fmt.Sprintf("authorize %s, token %s, register %s, methods %v", asm.AuthorizationEndpoint, asm.TokenEndpoint, asm.RegistrationEndpoint, asm.Methods))
	if !good {
		return errors.New("the authorization-server metadata is incomplete")
	}
	a.md.authorizationEndpoint, a.md.tokenEndpoint, a.md.registrationEndpoint = asm.AuthorizationEndpoint, asm.TokenEndpoint, asm.RegistrationEndpoint
	return nil
}

// wellKnown is RFC 8414's metadata URL: the well-known segment goes between the host and any issuer path.
func wellKnown(issuer, name string) string {
	u, err := url.Parse(issuer)
	if err != nil {
		return issuer + "/.well-known/" + name
	}
	u.Path = "/.well-known/" + name + strings.TrimRight(u.Path, "/")
	return u.String()
}

// register is dynamic client registration (RFC 7591) with the sim's callback.
func (a *oauthAttempt) register(ctx context.Context) error {
	doc, _ := json.Marshal(map[string]any{
		"client_name": "mcpsim (" + a.persona.name + ")", "redirect_uris": []string{a.s.callbackURL()},
		"grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"},
		"token_endpoint_auth_method": "none",
	})
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: a.md.registrationEndpoint, body: bytes.NewReader(doc), headers: map[string]string{contentType: applicationJSON}})
	var ans struct {
		ClientID string `json:"client_id"`
	}
	ok := (x.status == http.StatusCreated || x.status == http.StatusOK) && json.Unmarshal(x.body, &ans) == nil && ans.ClientID != ""
	a.rn.httpStep(Step{Kind: "register", Flow: FlowOAuth, Method: http.MethodPost, URL: a.md.registrationEndpoint, OK: ok, Detail: "client " + ans.ClientID}, x)
	a.rn.check("dynamic client registration answers a client_id", ok, fmt.Sprintf("%d %s", x.status, ans.ClientID))
	if !ok {
		return fmt.Errorf("registration answered %d", x.status)
	}
	a.clientID = ans.ClientID
	return nil
}
