package domain

import (
	"os"
	"strings"
)

// This file holds the parts of a child's environment that are about the way a
// lane READS, not about where its services are: the Node flags that keep a
// tool's own banner out of the terminal, and the telemetry switches for a
// stack whose observability container is not running. Both belong to every
// lane — the three long-running ones and the one-shot prepare/codegen/seed
// lanes alike — so they are assembled here and appended once, beside the
// service addresses in OverlayEnv.

// NodeQuietFlags are the Node CLI flags every lane inherits through
// NODE_OPTIONS.
//
// `--experimental-transform-types` is how every Node lane in this repository
// runs TypeScript, and Node 24 announces it on stderr on every single start:
//
//	(node:1376) ExperimentalWarning: Transform Types is an experimental feature
//	(Use `node --trace-warnings ...` to show where the warning was created)
//
// Two lines per lane, on every up, about a flag the repository chose on
// purpose. `--disable-warning` (Node 22.10+) is the flag that drops exactly
// that category and leaves every other warning — a deprecation, an unhandled
// rejection — where a developer can still see it.
//
// It is applied here rather than in each package's scripts because there are
// nine `package.json` files spelling the same invocation, and a tenth is one
// pull request away.
const NodeQuietFlags = "--disable-warning=ExperimentalWarning"

// NodeOptionsEnv returns the NODE_OPTIONS assignment for a child, preserving
// whatever the developer's own shell already put there — a debugger port, a
// heap limit — rather than replacing it. inherited is the value from the
// environment haven itself was started with ("" when unset).
func NodeOptionsEnv(inherited string) string {
	existing := strings.TrimSpace(inherited)
	if existing == "" {
		return "NODE_OPTIONS=" + NodeQuietFlags
	}
	if strings.Contains(existing, NodeQuietFlags) {
		return "NODE_OPTIONS=" + existing
	}
	return "NODE_OPTIONS=" + existing + " " + NodeQuietFlags
}

// NodeOptionsEnvFromProcess is NodeOptionsEnv against the environment haven
// itself runs in. It exists so a caller assembling a child's environment adds
// one line and needs no import of its own.
func NodeOptionsEnvFromProcess() string {
	return NodeOptionsEnv(os.Getenv("NODE_OPTIONS"))
}

// TelemetryOffEnv is what a stack whose observability container is NOT running
// tells its children.
//
// Saying nothing is not the same as saying off. haven's observabilityEnv only
// emits the collector variables while the stack is up, so with it down a child
// inherits whatever OTEL_* the developer's shell happens to carry — commonly a
// stale `http://localhost:4318` from a session when it was up. The nlp lane
// then exported metrics to a port that accepts the connection and never
// answers, and printed a failed upload every collection interval, forever.
//
// So the absence is stated: an empty debug-collector endpoint installs no
// second exporter, and OTEL_METRICS_ENABLED=false is the same switch the
// TypeScript spine already reads (packages/config) and the Go services read
// through pkg/config's OTel.MetricsExportDisabled.
func TelemetryOffEnv() []string {
	return []string{
		"OTEL_DEBUG_COLLECTOR_ENDPOINT=",
		"OTEL_METRICS_ENABLED=false",
	}
}
