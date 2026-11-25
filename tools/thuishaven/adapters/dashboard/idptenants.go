package dashboard

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// maxIdPState caps the simulator's state dump, which carries every seeded user.
const maxIdPState = 8 << 20

// FetchIdPTenants lists the tenants of the IdP simulator on a loopback port
// from its control state. Any failure is no tenants: a home page must not
// wait on a simulator that is still starting.
func FetchIdPTenants(ctx context.Context, port int) []IdPTenant {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/control/state", port), nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	return parseIdPTenants(io.LimitReader(resp.Body, maxIdPState))
}

func parseIdPTenants(body io.Reader) []IdPTenant {
	var state struct {
		Tenants []struct {
			ID      json.Number `json:"id"`
			Domain  string      `json:"domain"`
			BaseURL string      `json:"baseUrl"`
		} `json:"tenants"`
	}
	if err := json.NewDecoder(body).Decode(&state); err != nil {
		return nil
	}
	out := make([]IdPTenant, 0, len(state.Tenants))
	for _, t := range state.Tenants {
		out = append(out, IdPTenant{ID: t.ID.String(), Domain: t.Domain, URL: t.BaseURL})
	}
	return out
}
