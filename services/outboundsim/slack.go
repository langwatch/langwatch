package outboundsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// slackChannel is one channel of the seeded workspace, in conversations.list's shape.
type slackChannel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IsChannel bool   `json:"is_channel"`
	IsMember  bool   `json:"is_member"`
}

// slackWorkspace is the one Slack team outboundsim answers for.
type slackWorkspace struct {
	team, teamID, user, userID string
	channels                   []slackChannel
	mu                         sync.Mutex
	seq                        int
}

// channel finds a channel by id, name or #name.
func (w *slackWorkspace) channel(ref string) (slackChannel, bool) {
	ref = strings.TrimPrefix(ref, "#")
	for _, ch := range w.channels {
		if ref != "" && (ch.ID == ref || ch.Name == ref) {
			return ch, true
		}
	}
	return slackChannel{}, false
}

// nextTS is a message timestamp, unique for the life of the server.
func (w *slackWorkspace) nextTS(now time.Time) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.seq++
	return fmt.Sprintf("%d.%06d", now.Unix(), w.seq)
}

var slackMethods = map[string]bool{"chat.postMessage": true, "conversations.list": true, "auth.test": true}

func (s *Server) handleSlackWebhook(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelSlackWebhook, r.URL.Path)
	if !ok {
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(c.body, &payload); err != nil || payload == nil {
		s.finish(w, c, textReply(http.StatusBadRequest, "invalid_payload"))
		return
	}
	c.parsed = pick(payload, "text", "blocks", "attachments")
	s.finish(w, c, textReply(http.StatusOK, "ok"))
}

func (s *Server) handleSlackAPI(w http.ResponseWriter, r *http.Request) {
	method := r.PathValue("method")
	c, ok := readCall(w, r, ChannelSlackAPI, method)
	if !ok {
		return
	}
	args, isJSON := parseSlackArgs(c.body)
	token := slackToken(r.Header, args)
	if _, has := args["token"]; has {
		args["token"] = redacted
		c.body = encodeSlackArgs(args, isJSON)
	}
	c.parsed = pick(args, "channel", "text", "blocks", "attachments")
	c.parsed["method"] = method
	s.finish(w, c, s.slackAnswer(method, token, args))
}

// parseSlackArgs reads a Web API body, JSON or form-encoded, and says which.
func parseSlackArgs(body []byte) (map[string]any, bool) {
	args := map[string]any{}
	if json.Unmarshal(body, &args) == nil {
		if args == nil {
			args = map[string]any{}
		}
		return args, true
	}
	args = map[string]any{}
	if values, err := url.ParseQuery(string(body)); err == nil {
		for key, v := range values {
			args[key] = v[0]
		}
	}
	return args, false
}

func encodeSlackArgs(args map[string]any, isJSON bool) []byte {
	if isJSON {
		encoded, _ := json.Marshal(args)
		return encoded
	}
	values := url.Values{}
	for key, v := range args {
		values.Set(key, fmt.Sprint(v))
	}
	return []byte(values.Encode())
}

// slackToken is the bearer token, or the token argument older clients send.
func slackToken(h http.Header, args map[string]any) string {
	if token, ok := strings.CutPrefix(h.Get("Authorization"), "Bearer "); ok && token != "" {
		return token
	}
	token, _ := args["token"].(string)
	return token
}

func slackError(code string) reply {
	return jsonReply(http.StatusOK, map[string]any{"ok": false, "error": code})
}

// slackAnswer answers as Slack does: HTTP 200 with ok false and an error code.
func (s *Server) slackAnswer(method, token string, args map[string]any) reply {
	switch {
	case !slackMethods[method]:
		return slackError("unknown_method")
	case token == "":
		return slackError("not_authed")
	}
	switch method {
	case "auth.test":
		return jsonReply(http.StatusOK, map[string]any{
			"ok": true, "url": "https://outboundsim.slack.com/", "team": s.slack.team, "team_id": s.slack.teamID,
			"user": s.slack.user, "user_id": s.slack.userID, "bot_id": "B0SIM",
		})
	case "conversations.list":
		return jsonReply(http.StatusOK, map[string]any{
			"ok": true, "channels": s.slack.channels, "response_metadata": map[string]string{"next_cursor": ""},
		})
	}
	return s.slackPost(args)
}

func (s *Server) slackPost(args map[string]any) reply {
	text, _ := args["text"].(string)
	ref, _ := args["channel"].(string)
	ch, found := s.slack.channel(ref)
	switch {
	case !found:
		return slackError("channel_not_found")
	case text == "" && args["blocks"] == nil && args["attachments"] == nil:
		return slackError("no_text")
	}
	ts := s.slack.nextTS(s.now())
	return jsonReply(http.StatusOK, map[string]any{
		"ok": true, "channel": ch.ID, "ts": ts,
		"message": map[string]any{"type": "message", "user": s.slack.userID, "text": text, "ts": ts},
	})
}
