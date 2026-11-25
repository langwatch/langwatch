package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// startKeeperWait outlasts the daemon's own 10 s wait for the keeper.
const startKeeperWait = 15 * time.Second

// Client is app.DaemonClient: the up's side of the daemon's action routes.
type Client struct{}

// StartKeeper posts to the daemon's start route as a CLI, with Sec-Fetch-Site:
// none, the header guardAction asks of anything that is not a page. A daemon
// built before the route serves its console page there instead of a result.
func (Client) StartKeeper(ctx context.Context, port int, slug string) error {
	ctx, cancel := context.WithTimeout(ctx, startKeeperWait)
	defer cancel()
	target := fmt.Sprintf("http://127.0.0.1:%d/api/stacks/%s/start", port, url.PathEscape(slug))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Sec-Fetch-Site", "none")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", app.ErrDaemonNotReady, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxActionBody))
	if err != nil {
		return err
	}
	var result struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	switch {
	case json.Unmarshal(body, &result) != nil || result.Error == "" && result.Message == "":
		if resp.StatusCode == http.StatusOK {
			return fmt.Errorf("%w: the daemon does not know the start route; run `haven daemon restart`", app.ErrDaemonNotReady)
		}
		answer := fmt.Errorf("the daemon answered %s: %s", resp.Status, strings.TrimSpace(string(body)))
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode >= http.StatusBadGateway {
			return fmt.Errorf("%w: %w", app.ErrDaemonNotReady, answer)
		}
		return answer
	case result.Error != "":
		return errors.New(result.Error)
	}
	return nil
}
