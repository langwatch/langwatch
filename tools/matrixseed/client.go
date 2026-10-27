package matrixseed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// client calls the control plane's public REST routes as one credential.
type client struct {
	base  string
	http  *http.Client
	token string
}

// as is the same control plane, called with another credential.
func (c *client) as(token string) *client {
	next := *c
	next.token = token
	return &next
}

// route is one call: its method, path, body and promised status.
type route struct {
	method, path string
	body         any
	want         int
	// carriesKeys marks a call whose request held provider credentials: its
	// refusal never prints the response body.
	carriesKeys bool
}

// label names the call in errors.
func (r route) label() string { return r.method + " " + r.path }

// RefusedError is a route answering anything but the status it promises.
type RefusedError struct {
	Call   string
	Status int
	Body   string
}

func (e *RefusedError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("%s answered %d (body withheld)", e.Call, e.Status)
	}
	return fmt.Sprintf("%s answered %d: %s", e.Call, e.Status, e.Body)
}

type organization struct {
	Organization struct {
		ID string `json:"id"`
	} `json:"organization"`
	Team struct {
		ID string `json:"id"`
	} `json:"team"`
	AdminAPIKey struct {
		Token string `json:"token"`
	} `json:"adminApiKey"`
}

type project struct {
	ID            string `json:"id"`
	ServiceAPIKey string `json:"serviceApiKey"`
}

// provisionOrganization is the one route that exists before any organization.
func (c *client) provisionOrganization(ctx context.Context, name string) (organization, error) {
	var out organization
	err := c.call(ctx, route{method: http.MethodPost, path: "/api/v1/organizations",
		body: map[string]any{"name": name, "adminApiKeyName": name + " seed"}, want: http.StatusCreated}, &out)
	if err == nil && (out.Team.ID == "" || out.AdminAPIKey.Token == "") {
		err = fmt.Errorf("POST /api/v1/organizations answered without a team or an admin key")
	}
	return out, err
}

func (c *client) createProject(ctx context.Context, teamID, name string) (project, error) {
	var out project
	err := c.call(ctx, route{method: http.MethodPost, path: "/api/v1/projects",
		body: map[string]any{"name": name, "teamId": teamID, "language": "other", "framework": "other"},
		want: http.StatusCreated}, &out)
	if err == nil && (out.ID == "" || out.ServiceAPIKey == "") {
		err = fmt.Errorf("POST /api/v1/projects answered without a project id or a service key")
	}
	return out, err
}

// putModelProvider stores the project's row for provider and returns its id.
func (c *client) putModelProvider(ctx context.Context, provider string, keys map[string]string) (string, error) {
	var out map[string]struct {
		ID       *string `json:"id"`
		Provider string  `json:"provider"`
	}
	call := "PUT /api/v1/model-providers/" + provider
	if err := c.call(ctx, route{method: http.MethodPut, path: "/api/v1/model-providers/" + provider,
		body: map[string]any{"enabled": true, "customKeys": keys}, want: http.StatusOK, carriesKeys: true}, &out); err != nil {
		return "", err
	}
	for _, row := range out {
		if row.Provider == provider && row.ID != nil && *row.ID != "" {
			return *row.ID, nil
		}
	}
	return "", fmt.Errorf("%s answered without a stored %s row", call, provider)
}

// createVirtualKey mints a key that may use only the one model provider.
func (c *client) createVirtualKey(ctx context.Context, name, modelProviderID string) (string, error) {
	var out struct {
		Secret string `json:"secret"`
	}
	body := map[string]any{
		"name":        name,
		"description": "Minted by the gateway-matrix seed for this run only",
		"config":      map[string]any{"providersAllowed": []string{modelProviderID}},
	}
	if err := c.call(ctx, route{method: http.MethodPost, path: "/api/gateway/v1/virtual-keys",
		body: body, want: http.StatusCreated}, &out); err != nil {
		return "", err
	}
	if out.Secret == "" {
		return "", fmt.Errorf("POST /api/gateway/v1/virtual-keys answered without a secret")
	}
	return out.Secret, nil
}

func (c *client) call(ctx context.Context, r route, out any) error {
	payload, err := json.Marshal(r.body)
	if err != nil {
		return err
	}
	name := r.label()
	req, err := http.NewRequestWithContext(ctx, r.method, strings.TrimRight(c.base, "/")+r.path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%s: reading the answer: %w", name, err)
	}
	if resp.StatusCode != r.want {
		refused := &RefusedError{Call: name, Status: resp.StatusCode}
		if !r.carriesKeys {
			refused.Body = snippet(raw, append([]string{c.token}, stringValues(r.body)...))
		}
		return refused
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%s: decoding the answer: %w", name, err)
	}
	return nil
}

// stringValues collects every string in a JSON-shaped request body.
func stringValues(v any) []string {
	switch v := v.(type) {
	case string:
		return []string{v}
	case map[string]string:
		var out []string
		for _, s := range v {
			out = append(out, s)
		}
		return out
	case map[string]any:
		var out []string
		for _, s := range v {
			out = append(out, stringValues(s)...)
		}
		return out
	case []string:
		return v
	}
	return nil
}

// snippet keeps a refusal readable in the log. It first removes every secret
// the request submitted, raw and JSON-escaped, then truncates.
func snippet(raw []byte, secrets []string) string {
	s := strings.TrimSpace(string(raw))
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		for _, form := range secretForms(secret) {
			s = strings.ReplaceAll(s, form, "[redacted]")
		}
	}
	if len(s) > 300 {
		return s[:300] + "..."
	}
	return s
}

// secretForms is a secret as written raw and as a JSON string body, with and
// without HTML escaping.
func secretForms(secret string) []string {
	forms := []string{secret}
	for _, escapeHTML := range []bool{false, true} {
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(escapeHTML)
		if enc.Encode(secret) == nil {
			quoted := strings.TrimSpace(buf.String())
			forms = append(forms, quoted[1:len(quoted)-1])
		}
	}
	return forms
}
