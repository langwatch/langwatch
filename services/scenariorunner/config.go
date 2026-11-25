// Package scenariorunner is the Go scenario runner: a drop-in for the Node
// scenario child (apps/scenario-child). The worker spawns it the same way,
// with the same environment, writes one job to its stdin and reads the last
// JSON line of its stdout. It runs the job on the Go scenario SDK.
//
// @see specs/scenarios/child-execution-contract.feature
// @see specs/scenarios/go-scenario-runner.feature
package scenariorunner

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/scenariorunner/egress"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// Environment variables the parent states for a child, read once at the entrypoint.
const (
	envEndpoint               = "LANGWATCH_ENDPOINT"
	envAPIKey                 = "LANGWATCH_API_KEY"
	envVerbose                = "SCENARIO_VERBOSE"
	envRejectUnauthorized     = "NODE_TLS_REJECT_UNAUTHORIZED"
	envExtraCACerts           = "NODE_EXTRA_CA_CERTS"
	envNLPInternalSecret      = "LANGWATCH_NLP_INTERNAL_SECRET"
	envLogContext             = "LANGWATCH_LOG_CONTEXT"
	envResourceAttributes     = "OTEL_RESOURCE_ATTRIBUTES"
	envEngineCodeBlockTimeout = "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS"
	envNLPFetchMaxTimeout     = "NLP_FETCH_MAX_TIMEOUT_MS"
	envLogLevel               = "LOG_LEVEL"
	envServiceName            = "OTEL_SERVICE_NAME"
)

// Env is what the runner reads off the environment its parent stated.
type Env struct {
	LangWatchEndpoint  string
	LangWatchAPIKey    string
	Verbose            bool
	EgressPolicy       string
	RejectUnauthorized bool
	ExtraCAFile        string
	NLPInternalSecret  string
	LogContext         []LogField
	ResourceAttributes string
	NLPTimeouts        targets.NLPTimeouts
	LogLevel           string
	ServiceName        string
}

// LogField is one binding of the parent's logger context.
type LogField struct{ Key, Value string }

// logContextKeys are the bindings the parent may state, in schema order.
var logContextKeys = []string{"scenarioRunId", "batchRunId", "projectId", "scenarioId", "setId"}

// ReadEnv reads the environment through lookup; warnings (a malformed log
// context) go to warn, as the Node child writes them to stderr.
func ReadEnv(lookup func(string) string, warn io.Writer) Env {
	return Env{
		LangWatchEndpoint:  lookup(envEndpoint),
		LangWatchAPIKey:    lookup(envAPIKey),
		Verbose:            lookup(envVerbose) == "true",
		EgressPolicy:       lookup(egress.PolicyEnv),
		RejectUnauthorized: lookup(envRejectUnauthorized) != "0",
		ExtraCAFile:        strings.TrimSpace(lookup(envExtraCACerts)),
		NLPInternalSecret:  lookup(envNLPInternalSecret),
		LogContext:         decodeLogContext(lookup(envLogContext), warn),
		ResourceAttributes: lookup(envResourceAttributes),
		NLPTimeouts: targets.NLPTimeouts{
			EngineCodeBlockTimeoutSeconds: numberOrNil(lookup(envEngineCodeBlockTimeout)),
			MaxTimeoutMs:                  numberOrNil(lookup(envNLPFetchMaxTimeout)),
		},
		LogLevel:    lookup(envLogLevel),
		ServiceName: lookup(envServiceName),
	}
}

func numberOrNil(raw string) *float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return nil
	}
	return &f
}

// decodeLogContext never fails: unset or off-schema is empty, and malformed
// JSON warns so it is still visible during incident response.
func decodeLogContext(raw string, warn io.Writer) []LogField {
	if raw == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		_, _ = fmt.Fprintf(warn, "[child-logger] %s is not valid JSON; ignoring\n", envLogContext)
		return nil
	}
	var fields []LogField
	for _, k := range logContextKeys {
		v, ok := parsed[k]
		if !ok {
			continue
		}
		s, isString := v.(string)
		if !isString {
			return nil
		}
		fields = append(fields, LogField{Key: k, Value: s})
	}
	return fields
}
