package client

import "context"

// MonitorsService is the client for LangWatch evaluation monitors — evaluators
// that run automatically against incoming traces — and their enabled state.
//
// Access it via [Client.Monitors].
type MonitorsService struct {
	client *Client
}

// Monitor is a configured evaluation monitor as returned by the API.
type Monitor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// Enabled reports whether the monitor is currently active.
	Enabled bool `json:"enabled"`
	// CheckType identifies the evaluator powering the monitor.
	CheckType string `json:"checkType"`
	// EvaluatorID references the underlying evaluator, when applicable.
	EvaluatorID *string `json:"evaluatorId"`
	// ExecutionMode is how the monitor runs (e.g. "ON_MESSAGE").
	ExecutionMode string `json:"executionMode"`
	// Level is the monitor's severity/level.
	Level string `json:"level"`
	// Sample is the fraction of traffic evaluated, between 0 and 1.
	Sample float64 `json:"sample"`
	// PlatformURL deep-links to the monitor in the LangWatch UI.
	PlatformURL string `json:"platformUrl"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// List returns every monitor in the project.
//
//	monitors, err := lw.Monitors.List(ctx)
func (s *MonitorsService) List(ctx context.Context) ([]Monitor, error) {
	resp, err := s.client.gen.GetApiMonitors(ctx)
	var out []Monitor
	if derr := decodeInto("Monitors.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Get fetches a single monitor by ID.
//
//	m, err := lw.Monitors.Get(ctx, "monitor_abc")
func (s *MonitorsService) Get(ctx context.Context, id string) (*Monitor, error) {
	resp, err := s.client.gen.GetApiMonitorsById(ctx, id)
	var out Monitor
	if derr := decodeInto("Monitors.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Toggle enables or disables a monitor. The decoded API response is returned as
// a free-form map.
//
//	_, err := lw.Monitors.Toggle(ctx, "monitor_abc", false)
func (s *MonitorsService) Toggle(ctx context.Context, id string, enabled bool) (map[string]any, error) {
	body, err := jsonReader(map[string]bool{"enabled": enabled})
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiMonitorsByIdToggleWithBody(ctx, id, contentTypeJSON, body)
	var out map[string]any
	if derr := decodeInto("Monitors.Toggle", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Delete removes a monitor by ID.
//
//	err := lw.Monitors.Delete(ctx, "monitor_abc")
func (s *MonitorsService) Delete(ctx context.Context, id string) error {
	resp, err := s.client.gen.DeleteApiMonitorsById(ctx, id)
	return decodeInto("Monitors.Delete", resp, err, nil)
}
