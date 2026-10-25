package contract

import "time"

// Config is the module's configuration. nlpgo's Config embeds it under the
// NLPGO_EVALUATORS prefix; the module never reads the environment itself.
type Config struct {
	MaxInFlight           int   `env:"MAX_IN_FLIGHT"`
	MaxInFlightPerProject int   `env:"MAX_IN_FLIGHT_PER_PROJECT"`
	BusyWaitSeconds       int   `env:"BUSY_WAIT_SECONDS"`
	DeadlineSeconds       int   `env:"DEADLINE_SECONDS"`
	MaxBodyBytes          int64 `env:"MAX_BODY_BYTES"`
	// ShadowMaxInFlight caps shadow calls across the pod; a full budget
	// refuses at once, so shadow traffic never waits for or delays live work.
	ShadowMaxInFlight int `env:"SHADOW_MAX_IN_FLIGHT"`
}

// DefaultConfig is the module's defaults (plan §5.4, §5.5, D12). The deadline
// stays under the TS caller's 5-minute abort so cost is reported first.
func DefaultConfig() Config {
	return Config{
		MaxInFlight:           64,
		MaxInFlightPerProject: 8,
		BusyWaitSeconds:       10,
		DeadlineSeconds:       270,
		MaxBodyBytes:          16 << 20,
		ShadowMaxInFlight:     4,
	}
}

// Deadline is DeadlineSeconds as a duration.
func (c Config) Deadline() time.Duration { return time.Duration(c.DeadlineSeconds) * time.Second }

// BusyWait is BusyWaitSeconds as a duration.
func (c Config) BusyWait() time.Duration { return time.Duration(c.BusyWaitSeconds) * time.Second }
