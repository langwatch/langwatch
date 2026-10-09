package seedgen

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// Door is the door executor: the public OTLP doors at app (the haven route), authenticated by the
// project's API key. Keys maps a project id to its key; Key answers for any other project.
// ponytail: telemetry only; the tRPC session and REST kinds land with the persona lanes that need them.
type Door struct {
	App    string
	Keys   map[string]string
	Key    string
	client *http.Client
}

var doorPaths = map[string]string{KindTraceOTLP: "traces", KindLogOTLP: "logs", KindMetricOTLP: "metrics"}

// Send posts a telemetry action to its door; any other kind is refused as having no door route.
func (d *Door) Send(ctx context.Context, action Action) (Reply, error) {
	path, ok := doorPaths[action.Kind]
	if !ok {
		return Reply{ID: action.ID, Code: "no_door_route"}, nil
	}
	key := d.Keys[action.Project]
	if key == "" {
		key = d.Key
	}
	if d.client == nil {
		d.client = &http.Client{Timeout: time.Minute, Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(d.App, "/")+"/api/otel/v1/"+path, bytes.NewReader(action.Input))
	if err != nil {
		return Reply{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := d.client.Do(request)
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

// Close has nothing to release.
func (d *Door) Close() error { return nil }
