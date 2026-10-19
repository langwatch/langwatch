package mcpsim

import "time"

// Scenario names: each is one named run whose steps and checks the sim records.
const (
	ScenarioConnect       = "connect"        // initialize, notifications/initialized, tools/list, one tool call, DELETE
	ScenarioStream        = "stream"         // hold the GET event stream open and report if and when it drops
	ScenarioRefresh       = "refresh"        // OAuth: refresh, then keep the same session id with the new token
	ScenarioDoubleRefresh = "double-refresh" // OAuth: two concurrent refreshes with one refresh token
	ScenarioReconnect     = "reconnect"      // a lost session answers 404; re-initialize without signing in again
	ScenarioIdle          = "idle"           // sleep, then reuse the session
	ScenarioSoak          = "soak"           // N concurrent clients for a duration
	ScenarioOAuthConnect  = "oauth-connect"  // discovery, registration, PKCE, approval, code exchange
)

// Flows: how a run authenticates.
const (
	FlowAPIKey = "apikey" // Authorization: Bearer <project API key>
	FlowOAuth  = "oauth"  // the access token the OAuth connect obtained
)

// Run states. A run ends passed (every check passed), failed or stopped.
const (
	StateRunning = "running"
	StateWaiting = "waiting" // oauth-connect: waiting for a person to approve in the browser
	StatePassed  = "passed"
	StateFailed  = "failed"
	StateStopped = "stopped"
)

// RunRequest starts one scenario. Endpoint and APIKey default to the sim's configuration.
type RunRequest struct {
	Scenario string `json:"scenario"`
	Flow     string `json:"flow,omitempty"`   // apikey (default) or oauth
	Client   string `json:"client,omitempty"` // claude-code (default), claude-desktop or cursor
	// Transport is the MCP path: /mcp (default), /sse, or both (connect runs once on each).
	Transport string `json:"transport,omitempty"`
	Endpoint  string `json:"endpoint,omitempty"` // the LangWatch base URL, e.g. https://app.<slug>.langwatch.localhost
	APIKey    string `json:"apiKey,omitempty"`   // never reported back
	// Tool and ToolArgs name the harmless tool connect calls (default fetch_langwatch_docs with {}).
	Tool     string         `json:"tool,omitempty"`
	ToolArgs map[string]any `json:"toolArgs,omitempty"`
	// HoldSeconds is how long stream holds the event stream (default 60, max 7200).
	HoldSeconds int `json:"holdSeconds,omitempty"`
	// IdleSeconds is how long idle sleeps before reusing the session (default 30, max 7200).
	IdleSeconds int `json:"idleSeconds,omitempty"`
	// Clients and Duration shape soak (defaults 10 clients for 1m; max 500 clients, 2h).
	Clients  int    `json:"clients,omitempty"`
	Duration string `json:"duration,omitempty"`
	// Wait makes POST /_sim/api/runs answer once the run has ended, with 200.
	Wait bool `json:"wait,omitempty"`
}

// ConnectRequest starts the OAuth connect (POST /_sim/api/oauth/connect).
type ConnectRequest struct {
	// Mode is interactive (a person approves at AuthorizeURL) or auto (the sim approves
	// with a LangWatch session: Cookie, or the configured sign-in). Default: auto when the
	// sim has a cookie or sign-in, else interactive.
	Mode     string `json:"mode,omitempty"`
	Endpoint string `json:"endpoint,omitempty"`
	Client   string `json:"client,omitempty"`
	// Cookie is a LangWatch browser session, e.g. "better-auth.session_token=...". Never reported.
	Cookie string `json:"cookie,omitempty"`
	// ProjectID is the project the approval grants (default MCPSIM_PROJECT_ID).
	ProjectID string `json:"projectId,omitempty"`
	Wait      bool   `json:"wait,omitempty"`
}

// Step is one exchange with LangWatch, or one thing the sim did between them.
type Step struct {
	At        time.Time `json:"at"`
	Kind      string    `json:"kind"` // e.g. initialize, tools/list, tools/call, stream, refresh, register, token, delete, sleep
	Flow      string    `json:"flow,omitempty"`
	Transport string    `json:"transport,omitempty"` // /mcp or /sse where the step used one
	Method    string    `json:"method,omitempty"`
	URL       string    `json:"url,omitempty"`
	Status    int       `json:"status,omitempty"` // 0: no answer, or no request
	LatencyMs float64   `json:"latencyMs"`
	OK        bool      `json:"ok"`
	Session   string    `json:"session,omitempty"` // a hint of the mcp-session-id in use
	Detail    string    `json:"detail,omitempty"`
	Error     string    `json:"error,omitempty"`
}

// Check is one expectation a scenario asserts.
type Check struct {
	Name   string `json:"name"`
	Pass   bool   `json:"pass"`
	Detail string `json:"detail,omitempty"`
}

// Latency is attempt latency in milliseconds over a run's newest samples.
type Latency struct {
	Samples int     `json:"samples"`
	P50     float64 `json:"p50"`
	P90     float64 `json:"p90"`
	P99     float64 `json:"p99"`
	Max     float64 `json:"max"`
}

// LoadStats is a soak run's counters.
type LoadStats struct {
	Clients       int           `json:"clients"`
	Sessions      int64         `json:"sessions"`      // successful initializes
	Requests      int64         `json:"requests"`      // HTTP requests sent
	Errors        int64         `json:"errors"`        // requests that ended without the answer they needed
	Reinitialized int64         `json:"reinitialized"` // 404s answered by a silent re-initialize
	Refreshed     int64         `json:"refreshed"`     // 401s answered by a token refresh
	Retried       int64         `json:"retried"`       // 503s and dropped connections answered by a backoff retry
	Answers       map[int]int64 `json:"answers,omitempty"`
	Latency       *Latency      `json:"latency,omitempty"`
}

// RunStatus is one run: its settings, steps, checks and outcome.
type RunStatus struct {
	ID         string     `json:"id"`
	Scenario   string     `json:"scenario"`
	Flow       string     `json:"flow"`
	Client     string     `json:"client"`
	Endpoint   string     `json:"endpoint"`
	Transports []string   `json:"transports"`
	State      string     `json:"state"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	DurationMs float64    `json:"durationMs"`
	Steps      []Step     `json:"steps"`
	// StepsDropped counts steps beyond the run's bound (the oldest are dropped).
	StepsDropped int        `json:"stepsDropped,omitempty"`
	Checks       []Check    `json:"checks"`
	Load         *LoadStats `json:"load,omitempty"`
	// AuthorizeURL is where a person approves an interactive oauth-connect.
	AuthorizeURL string `json:"authorizeUrl,omitempty"`
	Error        string `json:"error,omitempty"`
}

// GrantStatus is the OAuth grant the sim holds, as hints only (never the tokens).
type GrantStatus struct {
	Connected     bool       `json:"connected"`
	Endpoint      string     `json:"endpoint,omitempty"`
	ClientID      string     `json:"clientId,omitempty"`
	ProjectID     string     `json:"projectId,omitempty"`
	AccessHint    string     `json:"accessHint,omitempty"`
	RefreshHint   string     `json:"refreshHint,omitempty"`
	ObtainedAt    *time.Time `json:"obtainedAt,omitempty"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	LastRefreshAt *time.Time `json:"lastRefreshAt,omitempty"`
	Refreshes     int        `json:"refreshes"`
}

// ScenarioInfo names one scenario for the console and the CLI.
type ScenarioInfo struct {
	Name    string   `json:"name"`
	Summary string   `json:"summary"`
	Flows   []string `json:"flows"`
}

// Status is GET /_sim/api/status. The API key and any session cookie are reported as hints.
type Status struct {
	Stack       string `json:"stack"`
	Endpoint    string `json:"endpoint,omitempty"`
	KeySource   string `json:"keySource,omitempty"`
	KeyHint     string `json:"keyHint,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	CallbackURL string `json:"callbackUrl"`
	// AutoApprove says how an auto oauth-connect would sign in: "cookie", "sign-in <email>" or "".
	AutoApprove string         `json:"autoApprove,omitempty"`
	OAuth       GrantStatus    `json:"oauth"`
	Scenarios   []ScenarioInfo `json:"scenarios"`
	Runs        []RunStatus    `json:"runs"` // newest first, without steps
}

// scenarios is the catalogue the console and `haven sim mcp` list.
var scenarios = []ScenarioInfo{
	{ScenarioConnect, "initialize, notifications/initialized, tools/list and one harmless tool call, then end the session", []string{FlowAPIKey, FlowOAuth}},
	{ScenarioStream, "hold the GET event stream open and report if and when it drops", []string{FlowAPIKey, FlowOAuth}},
	{ScenarioRefresh, "refresh the token, then keep using the same session id with the new one", []string{FlowOAuth}},
	{ScenarioDoubleRefresh, "two concurrent refreshes with one refresh token must both answer the same new pair", []string{FlowOAuth}},
	{ScenarioReconnect, "a lost session answers 404; re-initialize without signing in again", []string{FlowAPIKey, FlowOAuth}},
	{ScenarioIdle, "sleep, then reuse the session", []string{FlowAPIKey, FlowOAuth}},
	{ScenarioSoak, "N concurrent clients for a duration, each looping tools/list and the tool call", []string{FlowAPIKey, FlowOAuth}},
	{ScenarioOAuthConnect, "discovery, client registration, PKCE S256, approval, code exchange", []string{FlowOAuth}},
}
