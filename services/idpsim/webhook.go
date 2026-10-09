package idpsim

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// auth0WebhookPath is the stack's Auth0 SCIM log-stream intake.
const auth0WebhookPath = "/api/webhooks/auth0-scim"

var webhookClient = &http.Client{Timeout: 10 * time.Second}

// auth0WebhookRequest is the control body; Secret is never stored, recorded or echoed.
type auth0WebhookRequest struct {
	Target string `json:"target"`
	Secret string `json:"secret"`
	Token  string `json:"token"`
	User   string `json:"user"`
	Event  string `json:"event"`
}

// settle validates the request and fills its defaults from the tenant.
func (req *auth0WebhookRequest) settle(t *Tenant) error {
	if !isHTTPURL(req.Target) || req.Secret == "" {
		return errors.New("target (the stack's http(s) base URL) and secret are required")
	}
	if req.Token == "" {
		req.Token = t.Provisioning().Token
	}
	if req.Token == "" {
		return errors.New("no SCIM token: name one in the body, or connect the tenant first")
	}
	if req.Event == "" {
		req.Event = "create"
	}
	if req.Event != "create" && req.Event != "deactivate" {
		return errors.New("event must be create or deactivate")
	}
	return nil
}

func (req *auth0WebhookRequest) endpoint() string {
	return strings.TrimRight(req.Target, "/") + auth0WebhookPath
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https")
}

// handleControlAuth0Webhook sends one Auth0 log-stream SCIM event for a user,
// signed the way the stack's /api/webhooks/auth0-scim verifies it.
func (s *Server) handleControlAuth0Webhook(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var req auth0WebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "unparseable webhook body", http.StatusBadRequest)
		return
	}
	if err := req.settle(t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	user, ok := t.FindUser(req.User)
	if !ok {
		http.Error(w, "no user matches "+req.User, http.StatusNotFound)
		return
	}
	status, answer, err := s.sendAuth0Webhook(r.Context(), req, user)
	if err != nil {
		s.record(t, Event{Kind: "scim.webhook", Outcome: OutcomeRefused, Subject: user.Email, Detail: "could not reach " + req.endpoint()})
		http.Error(w, "could not reach "+req.endpoint()+": "+err.Error(), http.StatusBadGateway)
		return
	}
	s.record(t, Event{
		Kind: "scim.webhook", Outcome: OutcomeOK, Subject: user.Email,
		Detail: fmt.Sprintf("sent an Auth0 %s event to %s, answered %d", req.Event, req.endpoint(), status),
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "body": answer, "event": req.Event, "user": user.Email})
}

// sendAuth0Webhook posts the signed event and returns the stack's status and body.
func (s *Server) sendAuth0Webhook(ctx context.Context, req auth0WebhookRequest, user *User) (int, string, error) {
	payload, err := auth0LogEvent(user, req.Event, s.now())
	if err != nil {
		return 0, "", err
	}
	out, err := http.NewRequestWithContext(ctx, http.MethodPost, req.endpoint(), bytes.NewReader(payload))
	if err != nil {
		return 0, "", err
	}
	out.Header.Set("Content-Type", "application/json")
	out.Header.Set("Authorization", "Bearer "+req.Token)
	out.Header.Set("X-LangWatch-Signature", signAuth0Webhook(req.Secret, payload, s.now()))
	resp, err := webhookClient.Do(out)
	if err != nil {
		return 0, "", err
	}
	defer func() { _ = resp.Body.Close() }()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return resp.StatusCode, string(answer), nil
}

// auth0LogEvent is one Auth0 log-stream batch holding a single sscim event,
// the fields enterprise/modules/scim's directory stream reads.
func auth0LogEvent(u *User, event string, now time.Time) ([]byte, error) {
	description, operation := "Create a User", "create"
	if event == "deactivate" {
		description, operation = "Delete a User", "delete"
	}
	return json.Marshal([]map[string]any{{
		"log_id": randomToken(),
		"data": map[string]any{
			"date": now.UTC().Format(time.RFC3339), "type": "sscim", "description": description,
			"details": map[string]any{
				"operation": operation, "userName": u.Email,
				"body": map[string]any{
					"userName": u.Email,
					"name":     map[string]string{"givenName": u.GivenName, "familyName": u.FamilyName},
				},
			},
		},
	}})
}

// signAuth0Webhook is the X-LangWatch-Signature value: t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">.
func signAuth0Webhook(secret string, body []byte, at time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", at.Unix())
	mac.Write(body)
	return fmt.Sprintf("t=%d,v1=%s", at.Unix(), hex.EncodeToString(mac.Sum(nil)))
}
