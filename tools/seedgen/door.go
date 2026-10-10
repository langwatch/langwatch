package seedgen

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// Door is the door executor: the public OTLP doors at app (the haven route), authenticated by the
// project's API key. Keys maps a project id to its key; Key answers for any other project.
// Product kinds (tRPC as the signed-in account) and REST kinds live in door_product.go.
type Door struct {
	App  string
	Keys map[string]string
	Key  string
	// Email and Password sign the product kinds in (door_product.go); empty leaves them refused.
	Email, Password string
	client          *http.Client
	mu              sync.Mutex // guards cookie
	once            sync.Once
	cookie          string
}

var doorPaths = map[string]string{KindTraceOTLP: "traces", KindLogOTLP: "logs", KindMetricOTLP: "metrics"}

// Send posts a telemetry action to its door; any other kind is refused as having no door route.
func (d *Door) Send(ctx context.Context, action Action) (Reply, error) {
	path, ok := doorPaths[action.Kind]
	if _, trpc := productPaths[action.Kind]; trpc || restPaths[action.Kind] != "" {
		return d.sendProduct(ctx, action)
	}
	if !ok {
		return Reply{ID: action.ID, Code: "no_door_route"}, nil
	}
	key := d.Keys[action.Project]
	if key == "" {
		key = d.Key
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(d.App, "/")+"/api/otel/v1/"+path, bytes.NewReader(action.Input))
	if err != nil {
		return Reply{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := d.http().Do(request)
	if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil {
		return Reply{ID: action.ID, Code: "timeout", Retryable: true}, nil
	}
	if err != nil {
		return Reply{}, err
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	switch status := response.StatusCode; {
	case status < 300:
		return Reply{ID: action.ID, OK: true}, nil
	case status == http.StatusTooManyRequests || status >= 500:
		return Reply{ID: action.ID, Code: fmt.Sprintf("http_%d", status), Retryable: true}, nil
	default:
		return Reply{ID: action.ID, Code: fmt.Sprintf("http_%d", status)}, nil
	}
}

func (d *Door) http() *http.Client {
	d.once.Do(func() {
		d.client = &http.Client{Timeout: 3 * time.Minute, Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}
	})
	return d.client
}

// Close has nothing to release.
func (d *Door) Close() error { return nil }
