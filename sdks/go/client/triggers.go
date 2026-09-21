package client

import "context"

// TriggersService is the client for LangWatch triggers — automations that fire
// on matching trace activity (alerts, webhooks, dataset additions, …).
//
// Access it via [Client.Triggers].
type TriggersService struct {
	client *Client
}

// Trigger is a configured trigger as returned by the API.
type Trigger struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Active reports whether the trigger is enabled.
	Active bool `json:"active"`
	// Action is the trigger's action type (e.g. "send_email", "send_slack_message").
	Action string `json:"action"`
	// ActionParams carries action-specific configuration.
	ActionParams map[string]any `json:"actionParams"`
	// AlertType classifies the alert, when applicable.
	AlertType *string `json:"alertType"`
	// Filters is the trace-matching filter set.
	Filters map[string]any `json:"filters"`
	// Message is an optional custom message.
	Message *string `json:"message"`
	// PlatformURL deep-links to the trigger in the LangWatch UI.
	PlatformURL string `json:"platformUrl"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// List returns every trigger in the project.
//
//	triggers, err := lw.Triggers.List(ctx)
func (s *TriggersService) List(ctx context.Context) ([]Trigger, error) {
	resp, err := s.client.gen.GetApiTriggers(ctx)
	var out []Trigger
	if derr := decodeInto("Triggers.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Get fetches a single trigger by ID.
//
//	t, err := lw.Triggers.Get(ctx, "trigger_abc")
func (s *TriggersService) Get(ctx context.Context, id string) (*Trigger, error) {
	resp, err := s.client.gen.GetApiTriggersById(ctx, id)
	var out Trigger
	if derr := decodeInto("Triggers.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Delete removes a trigger by ID.
//
//	err := lw.Triggers.Delete(ctx, "trigger_abc")
func (s *TriggersService) Delete(ctx context.Context, id string) error {
	resp, err := s.client.gen.DeleteApiTriggersById(ctx, id)
	return decodeInto("Triggers.Delete", resp, err, nil)
}
