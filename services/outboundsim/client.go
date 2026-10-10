package outboundsim

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Client reads and steers a running outboundsim through its control API;
// haven's CLI and the diff tools assert through it that a call arrived.
type Client struct {
	// BaseURL is the sim's origin, e.g. https://outbound.<slug>.langwatch.localhost.
	BaseURL string
	// HTTP is the client to call it with; nil means http.DefaultClient.
	HTTP *http.Client
}

// do sends one control request, encoding in as JSON when given and decoding the answer into out when given.
func (c Client) do(ctx context.Context, method, target string, in, out any) error {
	var body bytes.Buffer
	if in != nil {
		if err := json.NewEncoder(&body).Encode(in); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+target, &body)
	if err != nil {
		return err
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("calling outboundsim at %s: %w", c.BaseURL, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("outboundsim at %s answered %d to %s %s", c.BaseURL, resp.StatusCode, method, target)
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Records lists the records matching f, newest first.
func (c Client) Records(ctx context.Context, f Filter) ([]Record, error) {
	query := url.Values{}
	for key, value := range map[string]string{"channel": f.Channel, "target": f.Target, "eventId": f.EventID} {
		if value != "" {
			query.Set(key, value)
		}
	}
	if !f.Since.IsZero() {
		query.Set("since", f.Since.Format(time.RFC3339Nano))
	}
	var list struct {
		Records []Record `json:"records"`
	}
	err := c.do(ctx, http.MethodGet, "/_sim/api/records?"+query.Encode(), nil, &list)
	return list.Records, err
}

// Clear forgets every record.
func (c Client) Clear(ctx context.Context) error {
	return c.do(ctx, http.MethodDelete, "/_sim/api/records", nil, nil)
}

// Deliveries lists webhook events with their attempts; an empty eventID lists them all.
func (c Client) Deliveries(ctx context.Context, eventID string) ([]Delivery, error) {
	var list struct {
		Deliveries []Delivery `json:"deliveries"`
	}
	err := c.do(ctx, http.MethodGet, "/_sim/api/deliveries?"+url.Values{"eventId": {eventID}}.Encode(), nil, &list)
	return list.Deliveries, err
}

// Faults lists the faults in force.
func (c Client) Faults(ctx context.Context) ([]Fault, error) {
	var list struct {
		Faults []Fault `json:"faults"`
	}
	err := c.do(ctx, http.MethodGet, "/_sim/api/faults", nil, &list)
	return list.Faults, err
}

// AddFault registers f and returns it with its id.
func (c Client) AddFault(ctx context.Context, f Fault) (Fault, error) {
	var added Fault
	err := c.do(ctx, http.MethodPost, "/_sim/api/faults", f, &added)
	return added, err
}

// ClearFaults removes every fault.
func (c Client) ClearFaults(ctx context.Context) error {
	return c.do(ctx, http.MethodDelete, "/_sim/api/faults", nil, nil)
}

// SetReceiverSecret registers the signing secret a /hooks/{name} delivery is checked against.
func (c Client) SetReceiverSecret(ctx context.Context, name, secret string) error {
	return c.do(ctx, http.MethodPut, "/_sim/api/receivers/"+url.PathEscape(name), map[string]string{"secret": secret}, nil)
}

// Setup is the URLs to paste into the product.
func (c Client) Setup(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	err := c.do(ctx, http.MethodGet, "/_sim/api/setup", nil, &out)
	return out, err
}
