package ciguard_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

const leanJob = `jobs:
  build:
    steps:
      - name: Checkout
        uses: actions/checkout@abc123
        with:
          sparse-checkout: |
            /*
            !/docs/media/
            !/docs/images/
            !/assets/
          sparse-checkout-cone-mode: false
      - name: Next
        run: echo hi
`

const gateJob = `jobs:
  changes:
    steps:
      - uses: actions/checkout@abc123
        with:
          sparse-checkout: .github
`

const bareJob = `jobs:
  build:
    steps:
      - uses: actions/checkout@abc123
      - name: Next
        run: echo hi
`

// writeWorkflows lays out a throwaway repo containing only the workflows the
// lean-checkout guard reads.
func writeWorkflows(t *testing.T, contents map[string]string) string {
	t.Helper()

	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ciscan.WorkflowDir), 0o750))

	for _, path := range ciguard.LeanCheckoutWorkflows {
		body, ok := contents[path]
		if !ok {
			body = leanJob
		}
		require.NoError(t, os.WriteFile(filepath.Join(root, path), []byte(body), 0o600))
	}

	return root
}

func TestLeanCheckoutAcceptsALeanStep(t *testing.T) {
	problems, err := ciguard.LeanCheckout(writeWorkflows(t, nil))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A new job added without the exclusion fails the check"
func TestLeanCheckoutReportsABareCheckoutByJobName(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: bareJob,
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], `job "build"`)
	assert.Contains(t, problems[0], "declares no sparse-checkout")
}

// @scenario "A gate job that reads no working tree takes only what it reads"
func TestLeanCheckoutExemptsAGateJob(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: gateJob,
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "Prose under docs/ is kept, because CI reads it"
func TestLeanCheckoutRejectsDroppingDocsWholesale(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: strings.Replace(leanJob,
			"            !/docs/media/\n            !/docs/images/\n", "            !/docs/\n", 1),
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "drops docs/ wholesale")
}

// @scenario "Cone mode is refused because it would drop a new top-level directory"
func TestLeanCheckoutRejectsNegationUnderConeMode(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: strings.Replace(leanJob,
			"          sparse-checkout-cone-mode: false\n", "", 1),
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "cone mode does not honor negation")
}

// @scenario "A cone-mode value that is neither true nor false fails the check"
func TestLeanCheckoutRejectsAnUnparseableConeModeValue(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: strings.Replace(leanJob,
			"sparse-checkout-cone-mode: false", "sparse-checkout-cone-mode: flase", 1),
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "neither true nor false")
}

// @scenario "The exclusions are root-anchored"
func TestLeanCheckoutRejectsAnUnanchoredExclusion(t *testing.T) {
	root := writeWorkflows(t, map[string]string{
		ciguard.LeanCheckoutWorkflows[0]: strings.Replace(leanJob, "!/assets/", "!assets/", 1),
	})

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "unanchored exclusion")
}

// @scenario "A job that needs the working tree still leaves the media behind"
func TestLeanCheckoutHoldsInTheLiveRepo(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.LeanCheckout(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

func TestLeanCheckoutWatchesRealCheckoutSteps(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	for _, path := range ciguard.LeanCheckoutWorkflows {
		workflow, err := ciscan.Load(root, path)
		require.NoError(t, err)
		assert.NotEmpty(t, workflow.CheckoutSteps(), "%s has no checkout steps to guard", path)
	}
}
