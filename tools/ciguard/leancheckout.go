package ciguard

import (
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// LeanCheckoutWorkflows are the workflows whose jobs check out the working
// tree to build or test the application.
var LeanCheckoutWorkflows = []string{
	".github/workflows/langwatch-app-ci.yml",
	".github/workflows/e2e-ci.yml",
	// migration-order earns its place by having been broken by the media: it
	// runs under timeout-minutes: 5 and 9 of its last 34 runs were killed by
	// that timeout mid-clone, at 297-298s in checkout against a 22.8s average
	// for the runs that finished.
	".github/workflows/migration-order.yml",
}

// RequiredExclusions are the repository's marketing media: 165 MB of .gif and
// .mp4 against 81 MB for platform/, the thing CI builds. Naming a
// sparse-checkout makes actions/checkout fetch with --filter=blob:none, so
// these blobs never cross the wire — a depth-1 clone drops from 180 MB to
// 42 MB of .git.
//
// Root-anchored on purpose: a bare "assets" would also drop
// services/langyagent/internal/assets, which the evaluator tests read.
var RequiredExclusions = []string{"!/docs/media/", "!/docs/images/", "!/assets/"}

// wholeDocsExclusion is what this guard exists to prevent a return to.
// error-remediation.unit.test.ts resolves the repo's docs/ and asserts every
// remediation link maps to a real .mdx, so dropping docs/ wholesale fails
// three test-unit shards. The .mdx tree is ~10 MB of docs/'s 138; the media
// is the other 128 and nothing in CI reads it.
const wholeDocsExclusion = "!/docs/"

// gateOnlyPattern is the checkout of a job that reads nothing outside
// .github — the change gates. They need no media exclusions because they take
// no working tree at all.
const gateOnlyPattern = ".github"

// LeanCheckout reports every checkout that would pull the media.
func LeanCheckout(repoRoot string) ([]string, error) {
	var problems []string

	for _, path := range LeanCheckoutWorkflows {
		workflow, err := ciscan.Load(repoRoot, path)
		if err != nil {
			return nil, err
		}

		steps := workflow.CheckoutSteps()
		if len(steps) == 0 {
			problems = append(problems, fmt.Sprintf("%s has no actions/checkout step, so this guard is watching nothing", path))

			continue
		}

		for _, step := range steps {
			problems = append(problems, leanCheckoutStep(step)...)
		}
	}

	return problems, nil
}

func leanCheckoutStep(step ciscan.CheckoutStep) []string {
	where := fmt.Sprintf("%s job %q", step.Workflow, step.Job)

	if sparse, ok := step.Step.StringWith("sparse-checkout"); ok && strings.TrimSpace(sparse) == gateOnlyPattern {
		return nil
	}

	patterns := step.Step.SparsePatterns()
	if len(patterns) == 0 {
		return []string{fmt.Sprintf("%s declares no sparse-checkout, so it pulls the media too", where)}
	}

	problems := keepsDocsProse(where, patterns)
	problems = append(problems, excludesTheMedia(where, patterns)...)
	problems = append(problems, anchorsItsExclusions(where, patterns)...)

	return append(problems, disablesConeMode(where, step.Step)...)
}

// keepsDocsProse rejects a return to dropping docs/ wholesale.
func keepsDocsProse(where string, patterns []string) []string {
	if !slices.Contains(patterns, wholeDocsExclusion) {
		return nil
	}

	return []string{fmt.Sprintf(
		"%s drops docs/ wholesale, which fails error-remediation.unit.test.ts — exclude the media beneath it instead", where)}
}

func excludesTheMedia(where string, patterns []string) []string {
	var problems []string
	for _, required := range RequiredExclusions {
		if !slices.Contains(patterns, required) {
			problems = append(problems, fmt.Sprintf("%s does not exclude %s", where, strings.TrimPrefix(required, "!")))
		}
	}

	return problems
}

// anchorsItsExclusions keeps `!/assets/` from also dropping
// services/langyagent/internal/assets, which the evaluator tests read.
func anchorsItsExclusions(where string, patterns []string) []string {
	var problems []string
	for _, pattern := range patterns {
		if strings.HasPrefix(pattern, "!") && !strings.HasPrefix(pattern, "!/") {
			problems = append(problems, fmt.Sprintf(
				"%s has an unanchored exclusion %q, which would also match nested directories of that name", where, pattern))
		}
	}

	return problems
}

// disablesConeMode catches negation under cone mode, where cone mode takes an
// include list and the negated pattern silently does nothing.
func disablesConeMode(where string, step ciscan.Step) []string {
	cone, valid := step.BoolWith("sparse-checkout-cone-mode")

	switch {
	case valid && !cone:
		return nil
	case step.Has("sparse-checkout-cone-mode") && !valid:
		// A value neither true nor false. Named separately because the fix is
		// different: it is a typo, not a missing setting.
		return []string{fmt.Sprintf(
			"%s sets sparse-checkout-cone-mode to a value that is neither true nor false", where)}
	default:
		return []string{fmt.Sprintf(
			"%s negates paths without sparse-checkout-cone-mode: false, and cone mode does not honor negation", where)}
	}
}
