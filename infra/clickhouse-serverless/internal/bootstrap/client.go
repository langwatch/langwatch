package bootstrap

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultURL is the server's HTTP interface on loopback.
const DefaultURL = "http://127.0.0.1:8123/"

// maxResponseBytes bounds what Query reads back.
const maxResponseBytes = 16 << 20

// Client runs SQL as the local admin over the server's loopback HTTP
// interface. It re-reads the credential on every call, so a server restart,
// which rotates the password, needs nothing from the caller.
type Client struct {
	Dir  string       // where the server wrote the password (DefaultDir)
	URL  string       // DefaultURL when empty
	HTTP *http.Client // a client with a 30 s timeout when nil
}

// Query runs sql and returns the response body.
func (c *Client) Query(ctx context.Context, sql string) ([]byte, error) {
	cred, err := Read(c.Dir)
	if err != nil {
		return nil, fmt.Errorf("local admin credential: %w", err)
	}
	url := c.URL
	if url == "" {
		url = DefaultURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(sql))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(cred.User, cred.Password)
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
