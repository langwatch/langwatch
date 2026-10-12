package analyticssim

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// Client reads a running analyticssim's query API; apidiff and visualdiff
// assert through it that a call reached a provider.
type Client struct {
	// BaseURL is the sim's origin, e.g. https://analytics.<slug>.langwatch.localhost.
	BaseURL string
	// HTTP is the client to call it with; nil means http.DefaultClient.
	HTTP *http.Client
}

// do sends one request to target, a path with its query string.
func (c Client) do(ctx context.Context, method, target string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+target, nil)
	if err != nil {
		return nil, err
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return httpClient.Do(req)
}

// Records lists the records matching f, newest first.
func (c Client) Records(ctx context.Context, f Filter) ([]Record, error) {
	query := url.Values{}
	for key, value := range map[string]string{"provider": f.Provider, "kind": f.Kind, "id": f.ID, "name": f.Name} {
		if value != "" {
			query.Set(key, value)
		}
	}
	resp, err := c.do(ctx, http.MethodGet, "/_sim/api/records?"+query.Encode())
	if err != nil {
		return nil, fmt.Errorf("reading analyticssim at %s: %w", c.BaseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("analyticssim at %s answered %d", c.BaseURL, resp.StatusCode)
	}
	var list struct {
		Records []Record `json:"records"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("analyticssim at %s answered no record list: %w", c.BaseURL, err)
	}
	return list.Records, nil
}

// Clear forgets every record.
func (c Client) Clear(ctx context.Context) error {
	resp, err := c.do(ctx, http.MethodDelete, "/_sim/api/records?")
	if err != nil {
		return fmt.Errorf("clearing analyticssim at %s: %w", c.BaseURL, err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("analyticssim at %s answered %d to a clear", c.BaseURL, resp.StatusCode)
	}
	return nil
}

// HasProperties reports whether r carries every wanted property: an empty
// wanted value asks only that the key is present, any other is compared with
// the property's JSON text (a string unquoted).
func HasProperties(r Record, want map[string]string) bool {
	for key, value := range want {
		got, ok := r.Properties[key]
		if !ok {
			return false
		}
		if value != "" && propertyText(got) != value {
			return false
		}
	}
	return true
}

func propertyText(v any) string {
	if text, ok := v.(string); ok {
		return text
	}
	encoded, _ := json.Marshal(v)
	return string(encoded)
}
