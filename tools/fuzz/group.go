package fuzz

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// versionSelector is the hidden alias segment of /api/<x>: `/api/<ns>/latest/<x>` and
// `/api/<ns>/<date>/<x>` answer as `/api/<ns>/<x>`.
var versionSelector = regexp.MustCompile(`/(latest|preview|\d{4}-\d{2}-\d{2})(/|$)`)

// isVersionAlias reports whether path is a dated or latest alias of another route.
func isVersionAlias(path string) bool { return versionSelector.MatchString(path) }

// canonicalRoute is the route an alias path stands for.
func canonicalRoute(path string) string {
	canonical := versionSelector.ReplaceAllString(path, "$2")
	if canonical == "" {
		return "/"
	}
	return canonical
}

// Finding is one oracle hit, written to findings.jsonl. Signature groups
// findings by distinct cause, so thousands of hits collapse to a short list.
type Finding struct {
	Oracle     string `json:"oracle"`
	Finding    bool   `json:"finding"`
	Method     string `json:"method,omitempty"`
	Route      string `json:"route"`     // path template, not the filled URL
	Signature  string `json:"signature"` // the grouping key
	Message    string `json:"message"`
	Status     int    `json:"status,omitempty"`
	Mutation   string `json:"mutation,omitempty"`
	Auth       string `json:"auth,omitempty"`
	Curl       string `json:"curl"`
	CapturedAt string `json:"capturedAt"`
}

// signatureOf is the grouping key: oracle, method, path template and status,
// so one distinct cause is one row however many times it fires.
func signatureOf(oracle string, op diffkit.Operation, status int) string {
	return fmt.Sprintf("%s :: %s %s :: %d", oracle, op.Method, canonicalRoute(op.Path), status)
}

// Group is one distinct cause with a count and a representative finding (the
// shrunk one).
type Group struct {
	Signature string
	Count     int
	Example   Finding
}

// GroupFindings collapses findings by signature, counting each, keeping the
// first (already-shrunk) as the example. The result is sorted by count.
func GroupFindings(findings []Finding) []Group {
	index := map[string]*Group{}
	order := make([]string, 0)
	for _, finding := range findings {
		group := index[finding.Signature]
		if group == nil {
			group = &Group{Signature: finding.Signature, Example: finding}
			index[finding.Signature] = group
			order = append(order, finding.Signature)
		}
		group.Count++
	}
	groups := make([]Group, 0, len(order))
	for _, key := range order {
		groups = append(groups, *index[key])
	}
	sort.SliceStable(groups, func(a, b int) bool { return groups[a].Count > groups[b].Count })
	return groups
}

// RenderFindingsMD is findings.md: one section per group, worst first, with the
// count, the message and the curl to reproduce.
func RenderFindingsMD(groups []Group, total int) string {
	var out strings.Builder
	fmt.Fprintf(&out, "# fuzz findings (%d distinct causes, %d hits)\n\n", len(groups), total)
	for _, group := range groups {
		fmt.Fprintf(&out, "## (%d) %s\n\n", group.Count, group.Signature)
		fmt.Fprintf(&out, "%s\n\n", group.Example.Message)
		fmt.Fprintf(&out, "```sh\n%s\n```\n\n", group.Example.Curl)
	}
	return out.String()
}

// Coverage is how much of the surface a run exercised.
type Coverage struct {
	OperationsTotal     int
	OperationsExercised int
}

// RenderCoverageMD is coverage.md.
func (coverage Coverage) RenderCoverageMD() string {
	percent := 0.0
	if coverage.OperationsTotal > 0 {
		percent = 100 * float64(coverage.OperationsExercised) / float64(coverage.OperationsTotal)
	}
	return fmt.Sprintf("# fuzz coverage\n\noperations exercised: %d/%d (%.0f%%)\n",
		coverage.OperationsExercised, coverage.OperationsTotal, percent)
}

// Timing is a run's timing block.
type Timing struct {
	Total     time.Duration
	Seed      time.Duration
	Fuzzing   time.Duration
	Shrinking time.Duration
	Requests  int
	Findings  int
}

func (timing Timing) String() string {
	rate := 0.0
	if timing.Fuzzing.Seconds() > 0 {
		rate = float64(timing.Requests) / timing.Fuzzing.Seconds()
	}
	round := func(d time.Duration) time.Duration { return d.Round(100 * time.Millisecond) }
	return fmt.Sprintf("timing: seed %s · fuzzing %s · shrinking %s · total %s\n  %d requests · %.0f req/s · %d findings\n",
		round(timing.Seed), round(timing.Fuzzing), round(timing.Shrinking), round(timing.Total),
		timing.Requests, rate, timing.Findings)
}
