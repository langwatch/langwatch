// Package suiteweights refreshes .github/package-suites.weights, the measured
// seconds run-package-suites.ts splits the package-suites shards by, from the
// job logs of recent green runs on main.
// Spec: specs/ci/package-suites-weights.feature
package suiteweights

import (
	"regexp"
	"strconv"
	"strings"
)

// Measurement is one package script as one package-suites job ran it.
type Measurement struct {
	Package string
	Script  string
	Seconds float64
	// Cached is true when Nx replayed the result instead of running the
	// suite, so the seconds say nothing about what the suite costs.
	Cached bool
}

// header is the group run-package-suites.ts prints when a script ends:
// `<package> (<dir>) — pnpm run <script> (<seconds>s)`. A script cut short by
// cancellation prints `(unfinished)` instead and is not a measurement.
var header = regexp.MustCompile(`##\[group\](\S+) \([^)]*\) — pnpm run (\S+) \((\d+)s\)\s*$`)

var ansi = regexp.MustCompile(`\x1b\[[0-9;]*m`)

const cacheReplay = "read the output from the cache"

// ParseJobLog reads every measured script out of one package-suites job log.
func ParseJobLog(log string) []Measurement {
	var found []Measurement
	for _, raw := range strings.Split(log, "\n") {
		line := ansi.ReplaceAllString(raw, "")
		if match := header.FindStringSubmatch(line); match != nil {
			seconds, _ := strconv.ParseFloat(match[3], 64)
			found = append(found, Measurement{Package: match[1], Script: match[2], Seconds: seconds})
			continue
		}
		if len(found) > 0 && strings.Contains(line, cacheReplay) {
			found[len(found)-1].Cached = true
		}
	}
	return found
}
