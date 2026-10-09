package sources

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// simAPITimeout bounds one control-API call; the sims answer from memory.
const simAPITimeout = 5 * time.Second

// SimAPI is a client for one simulator's loopback control API. It is the one
// seam the `haven <sim>` commands share: resolve the port from the stack's
// session, then GET, POST, PUT or DELETE JSON against it.
type SimAPI struct {
	base   string
	client *http.Client
}

// NewSimAPI dials a simulator on this machine's loopback port.
func NewSimAPI(port int) SimAPI { return NewSimAPIAt(fmt.Sprintf("http://127.0.0.1:%d", port)) }

// NewSimAPIAt dials a simulator at an explicit base URL.
func NewSimAPIAt(base string) SimAPI {
	return SimAPI{base: strings.TrimRight(base, "/"), client: &http.Client{Timeout: simAPITimeout}}
}

// Get reads one JSON document; into may be a *json.RawMessage.
func (a SimAPI) Get(path string, params url.Values, into any) error {
	return a.do(http.MethodGet, path, params, nil, into)
}

// Post sends body as JSON and decodes any JSON answer into into (nil to ignore it).
func (a SimAPI) Post(path string, body, into any) error {
	return a.do(http.MethodPost, path, nil, body, into)
}

// Put sends body as JSON and decodes any JSON answer into into (nil to ignore it).
func (a SimAPI) Put(path string, body, into any) error {
	return a.do(http.MethodPut, path, nil, body, into)
}

// Delete removes the resource at path.
func (a SimAPI) Delete(path string) error { return a.do(http.MethodDelete, path, nil, nil, nil) }

// GetRaw reads a path's bytes as-is, for non-JSON answers.
func (a SimAPI) GetRaw(path string, params url.Values) ([]byte, error) {
	var raw []byte
	return raw, a.do(http.MethodGet, path, params, nil, &raw)
}

// do refuses any non-2xx, carrying the sim's own body so the reason is not lost.
func (a SimAPI) do(method, path string, params url.Values, body, into any) error {
	target := a.base + path
	if len(params) > 0 {
		target += "?" + params.Encode()
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	ctx, cancel := context.WithTimeout(context.Background(), simAPITimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach the simulator at %s: %w", a.base, err)
	}
	defer func() { _ = resp.Body.Close() }()
	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("%s %s answered %s: %s", method, path, resp.Status, strings.TrimSpace(string(payload)))
	}
	if raw, ok := into.(*[]byte); ok {
		*raw = payload
		return nil
	}
	if into == nil || len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, into)
}
