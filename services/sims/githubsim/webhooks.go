package githubsim

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
	"strings"
)

// deliverRequest names one webhook to build from the sim's state and send to the stack.
type deliverRequest struct {
	Event           string   `json:"event"`
	Action          string   `json:"action"`
	InstallationID  int64    `json:"installationId"`
	Repo            string   `json:"repo"`
	Number          int      `json:"number"`
	BadSignature    bool     `json:"badSignature"`
	OmitSignature   bool     `json:"omitSignature"`
	RawBody         string   `json:"rawBody"`
	RepositoriesAdd []string `json:"repositories"`
}

type delivery struct {
	ID       string `json:"id"`
	At       string `json:"at"`
	Event    string `json:"event"`
	Action   string `json:"action"`
	Status   int    `json:"status"`
	Response string `json:"response"`
	Error    string `json:"error,omitempty"`
}

// sign is GitHub's X-Hub-Signature-256 over the exact body bytes.
func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) deliverAsync(req deliverRequest) {
	go func() { _, _ = s.deliver(req) }()
}

// deliver builds the payload from current state, signs it and posts it to the stack's webhook door.
func (s *Server) deliver(req deliverRequest) (delivery, error) {
	rec := delivery{ID: randomHex(8), At: s.stamp(), Event: req.Event, Action: req.Action}
	if s.cfg.WebhookURL == "" {
		rec.Error = "GITHUBSIM_WEBHOOK_URL is not set"
		s.remember(rec)
		return rec, errors.New(rec.Error)
	}
	body := []byte(req.RawBody)
	if req.RawBody == "" {
		payload, err := s.payload(req)
		if err != nil {
			rec.Error = err.Error()
			s.remember(rec)
			return rec, err
		}
		body, _ = json.Marshal(payload)
	}
	secret := s.cfg.WebhookSecret
	if req.BadSignature {
		secret += "-wrong"
	}
	httpReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, s.cfg.WebhookURL, bytes.NewReader(body))
	if err != nil {
		rec.Error = err.Error()
		s.remember(rec)
		return rec, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("User-Agent", "GitHub-Hookshot/githubsim")
	httpReq.Header.Set("X-GitHub-Event", req.Event)
	httpReq.Header.Set("X-GitHub-Delivery", rec.ID)
	if !req.OmitSignature {
		httpReq.Header.Set("X-Hub-Signature-256", sign(secret, body))
	}
	resp, err := s.client.Do(httpReq)
	if err != nil {
		rec.Error = err.Error()
		s.remember(rec)
		return rec, err
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	rec.Status, rec.Response = resp.StatusCode, strings.TrimSpace(string(answer))
	s.remember(rec)
	return rec, nil
}

func (s *Server) remember(rec delivery) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, rec)
	if over := len(s.sent) - s.cfg.MaxRecords; over > 0 {
		s.sent = append([]delivery(nil), s.sent[over:]...)
	}
}

// payload is GitHub's webhook body for the event, built from state. A deleted installation still
// names its last known account, so the caller must not have dropped it before delivering.
func (s *Server) payload(req deliverRequest) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sender := map[string]any{"login": "octocat", "id": 1, "type": "User"}
	switch req.Event {
	case "ping":
		return map[string]any{"zen": "Keep it logically awesome.", "hook_id": 1}, nil
	case "installation", "installation_repositories":
		in := s.installs[req.InstallationID]
		if in == nil {
			return nil, fmt.Errorf("no installation %d", req.InstallationID)
		}
		out := map[string]any{
			"action": req.Action, "sender": sender,
			"installation": map[string]any{"id": in.ID, "account": in.Account, "repository_selection": in.Selection},
		}
		if req.Event == "installation_repositories" {
			key := "repositories_added"
			if req.Action == "removed" {
				key = "repositories_removed"
			}
			names := []map[string]any{}
			for _, name := range req.RepositoriesAdd {
				names = append(names, map[string]any{"full_name": name})
			}
			out[key] = names
		}
		return out, nil
	case "pull_request":
		p := s.findPull(req.Repo, req.Number)
		if p == nil {
			return nil, fmt.Errorf("no pull request %s#%d", req.Repo, req.Number)
		}
		in := s.installationFor(p.Repo)
		var installationRef any
		if in != nil {
			installationRef = map[string]any{"id": in.ID}
		}
		name := p.Repo[strings.Index(p.Repo, "/")+1:]
		return map[string]any{
			"action": req.Action, "number": p.Number, "installation": installationRef, "sender": sender,
			"repository":   map[string]any{"name": name, "full_name": p.Repo, "owner": map[string]any{"login": s.ownerOf(p.Repo)}},
			"pull_request": s.pullJSON(p),
		}, nil
	}
	return nil, fmt.Errorf("githubsim builds ping, installation, installation_repositories and pull_request, not %q", req.Event)
}
