package client

import (
	"context"

	"github.com/langwatch/langwatch/sdks/go/client/internal/openapi"
)

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
	// Kind is what the trigger is: "AUTOMATION", "ALERT" (on a custom graph) or
	// "REPORT" (scheduled).
	Kind string `json:"kind"`
	// Active reports whether the trigger is enabled.
	Active bool `json:"active"`
	// Action is the trigger's action type (e.g. "SEND_EMAIL", "SEND_SLACK_MESSAGE").
	Action string `json:"action"`
	// ActionParams carries action-specific configuration. Credential values read
	// back as "[redacted]"; sending the placeholder back on an update keeps them.
	ActionParams map[string]any `json:"actionParams"`
	// AlertType classifies the alert, when applicable.
	AlertType *string `json:"alertType"`
	// CustomGraphID is the graph an alert watches, when Kind is "ALERT".
	CustomGraphID *string `json:"customGraphId"`
	// GraphAlert is the rule an alert fires by; nil for anything else.
	GraphAlert *GraphAlert `json:"graphAlert"`
	// Report is what a scheduled report renders and when; nil for anything else.
	Report map[string]any `json:"report"`
	// Filters is the trace-matching filter set.
	Filters map[string]any `json:"filters"`
	// FilterQuery is the trace query, when set; it supersedes Filters.
	FilterQuery *string `json:"filterQuery"`
	// Message is an optional custom message.
	Message *string `json:"message"`
	// PlatformURL deep-links to the trigger in the LangWatch UI.
	PlatformURL string `json:"platformUrl"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// GraphAlert is the rule a graph alert fires by: when SeriesName compared by
// Operator ("gt", "lt", "gte", "lte", "eq") against Threshold holds over the
// last TimePeriod minutes (1, 5, 15, 30, 60 or 1440).
type GraphAlert struct {
	Threshold  float64 `json:"threshold"`
	Operator   string  `json:"operator"`
	TimePeriod int     `json:"timePeriod"`
	SeriesName string  `json:"seriesName"`
}

// CreateTriggerParams is the request body for [TriggersService.Create]. Name,
// Action and ActionParams are required. Slack delivers through a connection:
// set "slackIntegrationId" (plus "slackChannelId" for a bot connection) in
// ActionParams. Set CustomGraphID, GraphAlert and AlertType for a graph alert,
// or Report for a scheduled report.
type CreateTriggerParams struct {
	Name          string         `json:"name"`
	Action        string         `json:"action"`
	ActionParams  map[string]any `json:"actionParams"`
	Filters       map[string]any `json:"filters,omitempty"`
	FilterQuery   string         `json:"filterQuery,omitempty"`
	Message       string         `json:"message,omitempty"`
	AlertType     string         `json:"alertType,omitempty"`
	CustomGraphID string         `json:"customGraphId,omitempty"`
	GraphAlert    *GraphAlert    `json:"graphAlert,omitempty"`
	Report        map[string]any `json:"report,omitempty"`
	Templates     map[string]any `json:"templates,omitempty"`
	// NotificationCadence is "immediate" or a digest ("5min_digest", …).
	NotificationCadence string `json:"notificationCadence,omitempty"`
	TraceDebounceMs     *int   `json:"traceDebounceMs,omitempty"`
}

// UpdateTriggerParams is the request body for [TriggersService.Update]. Only
// the fields set are sent; the rest keep their stored values. Credentials in
// ActionParams read back as "[redacted]": send that placeholder to keep them.
type UpdateTriggerParams struct {
	Name                *string        `json:"name,omitempty"`
	Active              *bool          `json:"active,omitempty"`
	Action              string         `json:"action,omitempty"`
	ActionParams        map[string]any `json:"actionParams,omitempty"`
	Filters             map[string]any `json:"filters,omitempty"`
	FilterQuery         *string        `json:"filterQuery,omitempty"`
	Message             *string        `json:"message,omitempty"`
	AlertType           *string        `json:"alertType,omitempty"`
	GraphAlert          *GraphAlert    `json:"graphAlert,omitempty"`
	Report              map[string]any `json:"report,omitempty"`
	Templates           map[string]any `json:"templates,omitempty"`
	NotificationCadence string         `json:"notificationCadence,omitempty"`
	TraceDebounceMs     *int           `json:"traceDebounceMs,omitempty"`
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

// Create creates a trigger and returns it.
//
//	t, err := lw.Triggers.Create(ctx, client.CreateTriggerParams{Name: "Errors", Action: "SEND_SLACK_MESSAGE",
//		ActionParams: map[string]any{"slackIntegrationId": "slack_abc", "slackChannelId": "C0123"}})
func (s *TriggersService) Create(ctx context.Context, params CreateTriggerParams) (*Trigger, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiTriggersWithBody(ctx, contentTypeJSON, body)
	var out Trigger
	if derr := decodeInto("Triggers.Create", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Update changes the fields set in params and returns the updated trigger.
//
//	name := "Errors to #oncall"
//	t, err := lw.Triggers.Update(ctx, "trigger_abc", client.UpdateTriggerParams{Name: &name})
func (s *TriggersService) Update(ctx context.Context, id string, params UpdateTriggerParams) (*Trigger, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PatchApiTriggersByIdWithBody(ctx, id, contentTypeJSON, body)
	var out Trigger
	if derr := decodeInto("Triggers.Update", resp, err, &out); derr != nil {
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

// TriggerFiresParams controls cursor pagination for [TriggersService.Fires].
// All fields are optional.
type TriggerFiresParams struct {
	// Limit caps the page size (the API defaults to 20, at most 100).
	Limit int
	// Cursor continues a previous page; pass the value returned as NextCursor.
	Cursor string
}

// TriggerFire is one time a trigger fired.
type TriggerFire struct {
	ID            string  `json:"id"`
	TriggerID     string  `json:"triggerId"`
	CustomGraphID *string `json:"customGraphId"`
	FiredAt       string  `json:"firedAt"`
	// ResolvedAt is when an alert cleared; nil while it is still firing.
	ResolvedAt *string `json:"resolvedAt"`
}

// TriggerFiresPage is one page of fires, newest first. NextCursor is nil on the
// last page.
type TriggerFiresPage struct {
	Fires      []TriggerFire `json:"fires"`
	NextCursor *string       `json:"nextCursor"`
}

// Fires returns one page of a trigger's fires, newest first. Pass the page's
// NextCursor back as Cursor to read the next one, until it is nil.
//
//	page, err := lw.Triggers.Fires(ctx, "trigger_abc", client.TriggerFiresParams{Limit: 50})
func (s *TriggersService) Fires(ctx context.Context, id string, params TriggerFiresParams) (*TriggerFiresPage, error) {
	p := &openapi.GetApiTriggersByIdFiresParams{}
	if params.Limit > 0 {
		p.Limit = &params.Limit
	}
	if params.Cursor != "" {
		p.Cursor = &params.Cursor
	}
	resp, err := s.client.gen.GetApiTriggersByIdFires(ctx, id, p)
	var out TriggerFiresPage
	if derr := decodeInto("Triggers.Fires", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Enable turns a trigger on and returns it.
//
//	t, err := lw.Triggers.Enable(ctx, "trigger_abc")
func (s *TriggersService) Enable(ctx context.Context, id string) (*Trigger, error) {
	resp, err := s.client.gen.PostApiTriggersByIdEnable(ctx, id)
	var out Trigger
	if derr := decodeInto("Triggers.Enable", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Disable turns a trigger off without deleting it and returns it.
//
//	t, err := lw.Triggers.Disable(ctx, "trigger_abc")
func (s *TriggersService) Disable(ctx context.Context, id string) (*Trigger, error) {
	resp, err := s.client.gen.PostApiTriggersByIdDisable(ctx, id)
	var out Trigger
	if derr := decodeInto("Triggers.Disable", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// TestFireResult reports a test delivery sent by [TriggersService.TestFire].
type TestFireResult struct {
	// Channel is "email", "slack" or "webhook".
	Channel        string `json:"channel"`
	RecipientCount int    `json:"recipientCount"`
	// UsedDefault reports whether the LangWatch default message was rendered
	// because the trigger states no template of its own.
	UsedDefault      bool     `json:"usedDefault"`
	MissingVariables []string `json:"missingVariables"`
	Errors           []string `json:"errors"`
	// HTTPStatus is what a webhook endpoint answered with; nil otherwise.
	HTTPStatus *int `json:"httpStatus"`
}

// TestFire sends a test delivery through the trigger's configured channel.
//
//	res, err := lw.Triggers.TestFire(ctx, "trigger_abc")
//	if err == nil && len(res.Errors) > 0 { /* delivery failed */ }
func (s *TriggersService) TestFire(ctx context.Context, id string) (*TestFireResult, error) {
	resp, err := s.client.gen.PostApiTriggersByIdTestFire(ctx, id)
	var out TestFireResult
	if derr := decodeInto("Triggers.TestFire", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}
