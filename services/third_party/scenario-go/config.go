package scenario

import (
	"errors"
	"fmt"
	"time"
)

// Defaults, matching the JS SDK.
const (
	DefaultMaxTurns          = 10
	DefaultTraceWaitTimeout  = 30 * time.Second
	DefaultTraceQuietPeriod  = 2 * time.Second
	DefaultLangWatchEndpoint = "https://app.langwatch.ai"
	defaultScenarioSetID     = "default"
	eventBusDrainTimeout     = 300 * time.Second
)

// LangWatchConfig configures reporting to LangWatch. Empty fields fall back
// to LANGWATCH_ENDPOINT, LANGWATCH_API_KEY and LANGWATCH_PROJECT_ID.
type LangWatchConfig struct {
	Endpoint string
	// APIKey is a project key (sk-lw-…) or a personal access token (pat-lw-…).
	APIKey string
	// ProjectID selects the project; required with personal access tokens.
	ProjectID string
}

// FieldValue is a value a scenario carries next to its description: a
// string, a number or a bool.
type FieldValue = any

// ScenarioConfig describes one scenario.
type ScenarioConfig struct {
	// ID identifies the scenario; generated ("scenario_…") when empty.
	ID string
	// Name is required.
	Name string
	// Description is required; agents and the judge read it.
	Description string
	// Agents take part in the scenario; at least one has AgentRoleAgent.
	Agents []AgentAdapter
	// Parameters are run parameters for connected agents.
	Parameters map[string]ParameterValue
	// Script controls the conversation; defaults to Proceed().
	Script []ScriptStep
	// Fields are values the scenario carries, such as a golden SQL query.
	Fields map[string]FieldValue
	// Evaluators run once the scenario has a verdict.
	Evaluators []ScenarioEvaluator
	// EvaluatorRunner runs Evaluators; falls back to the one registered with
	// Configure(WithEvaluatorRunner(...)).
	EvaluatorRunner EvaluatorRunner
	// Extensions hook into the run (see Extension). Agents implementing
	// ExtensionProvider contribute theirs automatically.
	Extensions []Extension
	// Values is a per-run key/value store read through Executor.Value, the
	// carrier for subsystem configuration such as voice settings.
	Values map[any]any

	// MaxTurns caps the conversation; defaults to DefaultMaxTurns.
	MaxTurns int
	// MinTurns is the number of turns that always run before the judge may
	// volunteer a verdict. Explicit judge steps and the last turn still force
	// one. Must not exceed MaxTurns.
	MinTurns int
	// Verbose prints the transcript of failing runs.
	Verbose bool
	// ThreadID identifies the conversation; generated when empty.
	ThreadID string
	// SetID groups scenarios in LangWatch; "default" when empty.
	SetID string
	// Metadata is attached to the run. The "langwatch" key is reserved.
	Metadata map[string]any

	// FetchRemoteTraces makes the judge fetch the agent's remote traces from
	// LangWatch before its verdict. Nil falls back to Configure.
	FetchRemoteTraces *bool
	// TraceWaitTimeout bounds the verdict-time wait for remote traces.
	TraceWaitTimeout time.Duration
	// TraceWaitExtension is the judge's one extra wait (wait_for_traces).
	TraceWaitExtension time.Duration
	// TraceQuietPeriod is how long a remote trace must stay unchanged to count
	// as complete. Nil falls back to Configure, then DefaultTraceQuietPeriod.
	TraceQuietPeriod *time.Duration

	// LangWatch overrides the environment for this scenario.
	LangWatch LangWatchConfig
}

// Validation errors.
var (
	ErrNameRequired        = errors.New("scenario name is required")
	ErrDescriptionRequired = errors.New("scenario description is required")
	ErrMaxTurns            = errors.New("max turns must be at least 1")
	ErrNoAgents            = errors.New("at least one agent is required")
	ErrNoAgentUnderTest    = errors.New("at least one non-user/non-judge agent is required")
	ErrMinTurns            = errors.New("minTurns must be a non-negative integer")
)

// validate checks the config like the JS run() and executor constructor do.
func (c *ScenarioConfig) validate() error {
	if c.Name == "" {
		return ErrNameRequired
	}
	if c.Description == "" {
		return ErrDescriptionRequired
	}
	if c.MaxTurns < 0 {
		return ErrMaxTurns
	}
	if len(c.Agents) == 0 {
		return ErrNoAgents
	}
	hasAgent := false
	for i, a := range c.Agents {
		if a == nil {
			return fmt.Errorf("agent %d is nil", i)
		}
		if !a.Role().valid() {
			return fmt.Errorf("agent %d has invalid role: %s", i, a.Role())
		}
		hasAgent = hasAgent || a.Role() == AgentRoleAgent
	}
	if !hasAgent {
		return ErrNoAgentUnderTest
	}
	if c.MinTurns < 0 {
		return ErrMinTurns
	}
	maxTurns := c.MaxTurns
	if maxTurns == 0 {
		maxTurns = DefaultMaxTurns
	}
	if c.MinTurns > maxTurns {
		return fmt.Errorf("minTurns (%d) cannot exceed maxTurns (%d)", c.MinTurns, maxTurns)
	}
	return nil
}

// withDefaults returns the config with ids and defaults filled in.
func (c ScenarioConfig) withDefaults() ScenarioConfig {
	if c.ID == "" {
		c.ID = generateScenarioID()
	}
	if c.ThreadID == "" {
		c.ThreadID = generateThreadID()
	}
	if c.SetID == "" {
		c.SetID = defaultScenarioSetID
	}
	if c.MaxTurns == 0 {
		c.MaxTurns = DefaultMaxTurns
	}
	if len(c.Script) == 0 {
		c.Script = []ScriptStep{Proceed()}
	}
	return c
}
