package cmd

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/langwatch/langwatch/services/sims/mcpsim"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// mcpOAuth starts the OAuth connect, shows the approval page when a person must
// approve, then follows the run until it ends.
func mcpOAuth(api sources.SimAPI, inv invocation, asJSON bool) error {
	timeout, err := mcpDuration(inv, 5*time.Minute)
	if err != nil {
		return err
	}
	req, err := mcpConnectRequest(inv)
	if err != nil {
		return err
	}
	var raw json.RawMessage
	if err := api.Post("/_sim/api/oauth/connect", req, &raw); err != nil {
		return err
	}
	raw, err = mcpFollow(api, raw, mcpWait{timeout: timeout, authorize: func(authorize string) { mcpShowAuthorize(authorize, inv.has("--open"), asJSON) }})
	if err != nil {
		return err
	}
	return mcpOutcome(raw, asJSON)
}

// mcpDuration is --timeout, else fallback.
func mcpDuration(inv invocation, fallback time.Duration) (time.Duration, error) {
	raw := inv.value("--timeout")
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("--timeout %q is not a duration, e.g. 5m", raw)
	}
	return d, nil
}

// mcpConnectRequest maps the flags onto the OAuth connect; the cookie falls back to $MCPSIM_COOKIE.
func mcpConnectRequest(inv invocation) (mcpsim.ConnectRequest, error) {
	mode := inv.value("--mode")
	if mode != "" && mode != "auto" && mode != "interactive" {
		return mcpsim.ConnectRequest{}, fmt.Errorf("--mode %q: use auto or interactive", mode)
	}
	cookie := inv.value("--cookie")
	if cookie == "" {
		cookie = os.Getenv("MCPSIM_COOKIE")
	}
	return mcpsim.ConnectRequest{
		Mode: mode, Cookie: cookie, ProjectID: inv.value("--project"), Endpoint: inv.value("--target"), Client: inv.value("--client"),
	}, nil
}

// mcpWait is how long mcpFollow follows a run, and what it calls with the
// approval page the first time the run waits for one.
type mcpWait struct {
	timeout   time.Duration
	authorize func(string)
}

// mcpFollow polls a run until it is no longer running or waiting.
func mcpFollow(api sources.SimAPI, raw json.RawMessage, wait mcpWait) (json.RawMessage, error) {
	st, err := mcpDecodeRun(raw)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(wait.timeout)
	shown := false
	for st.State == mcpsim.StateRunning || st.State == mcpsim.StateWaiting {
		if st.State == mcpsim.StateWaiting && st.AuthorizeURL != "" && !shown {
			shown = true
			wait.authorize(st.AuthorizeURL)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("mcp oauth-connect %s still %s after %s; approve at %s or raise --timeout", st.ID, st.State, wait.timeout, st.AuthorizeURL)
		}
		time.Sleep(mcpPollInterval)
		if raw, st, err = mcpPoll(api, st.ID); err != nil {
			return nil, err
		}
	}
	return raw, nil
}

// mcpPoll reads one run again.
func mcpPoll(api sources.SimAPI, id string) (json.RawMessage, mcpsim.RunStatus, error) {
	var raw json.RawMessage
	if err := api.Get("/_sim/api/runs/"+url.PathEscape(id), nil, &raw); err != nil {
		return nil, mcpsim.RunStatus{}, err
	}
	st, err := mcpDecodeRun(raw)
	return raw, st, err
}

func mcpDecodeRun(raw json.RawMessage) (mcpsim.RunStatus, error) {
	var st mcpsim.RunStatus
	err := json.Unmarshal(raw, &st)
	return st, err
}

// mcpShowAuthorize names the approval page on stderr, so --json keeps stdout one document.
func mcpShowAuthorize(authorize string, open, asJSON bool) {
	out := os.Stdout
	if asJSON {
		out = os.Stderr
	}
	_, _ = fmt.Fprintf(out, "approve the connect in the browser: %s\n", authorize)
	if open {
		if err := mcpOpen(authorize); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "could not open the browser: %v\n", err)
		}
	}
}
