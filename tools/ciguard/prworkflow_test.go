package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

const calledWorkflow = `name: %[1]s
on:
  workflow_call:
  push:
    branches: [main]
concurrency:
  group: %[1]s-${{ github.ref }}
jobs:
  changes:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/detect-changes
        with:
          filters: |
            relevant:
              - '%[1]s/**'
            ingest:
              - 'ingest/%[1]s/**'
`

// prTree writes a tree that keeps every promise, then lets edit break one.
func prTree(t *testing.T, edit func(name, content string) string) string {
	t.Helper()
	root := t.TempDir()
	write := func(rel, content string) {
		path := filepath.Join(root, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(edit(rel, content)), 0o600))
	}
	var outputs, calls, results, skips strings.Builder
	for _, call := range PRCalls {
		write(filepath.Join(ciscan.WorkflowDir, call.File), fmt.Sprintf(calledWorkflow, call.Key))
		fmt.Fprintf(&outputs, "      %[1]s: ${{ steps.filter.outputs.%[1]s || steps.force.outputs.all }}\n", call.Key)
		fmt.Fprintf(&calls, "  %[1]s:\n    needs: changes\n    if: needs.changes.outputs.%[1]s == 'true'\n    uses: ./.github/workflows/%[2]s\n", call.Key, call.File)
		fmt.Fprintf(&skips, "%s, ", call.Key)
	}
	for _, context := range PRRequired {
		fmt.Fprintf(&results, "            %s=${{ needs.app.result }}\n", context)
	}
	write(PRWorkflowFile, "name: pr\non:\n  pull_request:\njobs:\n  changes:\n    outputs:\n"+outputs.String()+calls.String()+
		"  ci-complete:\n    steps:\n      - env:\n          RESULTS: >-\n"+results.String()+
		"          CHANGES: ${{ needs.changes.result }}\n"+
		"        run: case \"$result\" in success | skipped) state=success ;; esac; [ \"$CHANGES\" = success ] || state=failure\n"+
		"      - uses: re-actors/alls-green@v1\n        with:\n          allowed-skips: "+strings.TrimSuffix(skips.String(), ", ")+"\n")
	filters, err := PRFilters(root)
	require.NoError(t, err)
	write(PRFiltersFile, filters)

	return root
}

func keep(_, content string) string { return content }

func TestPRWorkflowAcceptsATreeThatKeepsEveryPromise(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, keep))
	require.NoError(t, err)
	require.Empty(t, problems)
}

func TestPRWorkflowAcceptsTheRealTree(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	problems, err := PRWorkflow(root)
	require.NoError(t, err)
	require.Empty(t, problems)
}

// @scenario "Each product check starts only when a change reaches its own paths"
func TestPRFiltersHoldEveryPathACheckConsults(t *testing.T) {
	root := prTree(t, keep)
	filters, err := PRFilters(root)
	require.NoError(t, err)
	require.Contains(t, filters, "docs:\n  - \"docs/**\"\n  - \"ingest/docs/**\"\n  - \".github/workflows/pr.yml\"\n  - \".github/pr-filters.yml\"\n")

	stale := filepath.Join(root, ciscan.WorkflowDir, "docs-ci.yml")
	content, err := os.ReadFile(stale)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(stale, []byte(strings.Replace(string(content), "'docs/**'", "'docs/**'\n              - 'more/**'", 1)), 0o600)) //nolint:gosec // G703: a path under t.TempDir
	problems, err := PRWorkflow(root)
	require.NoError(t, err)
	require.Contains(t, problems, PRFiltersFile+" is stale: run `go run ./cmd/prfilters`")
}

// @scenario "pr.yml is the only way a pull request starts a product check"
func TestPRWorkflowReportsACheckThatStartsItself(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, func(name, content string) string {
		if strings.HasSuffix(name, "e2e-ci.yml") {
			return strings.Replace(content, "  workflow_call:\n", "  pull_request:\n", 1)
		}
		if name == PRWorkflowFile {
			return strings.Replace(content, "    if: needs.changes.outputs.nlp == 'true'\n", "", 1)
		}

		return content
	}))
	require.NoError(t, err)
	require.Contains(t, problems, ".github/workflows/e2e-ci.yml: cannot be called (no workflow_call)")
	require.Contains(t, problems, ".github/workflows/e2e-ci.yml: still starts on pull_request; pr.yml starts it")
	require.Contains(t, problems, PRWorkflowFile+": job nlp is not started on its changes key")
}

// @scenario "Called checks never cancel each other"
func TestPRWorkflowReportsAGroupNamedAfterTheCaller(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, func(name, content string) string {
		if strings.HasSuffix(name, "codeql.yml") {
			return strings.Replace(content, "group: codeql-", "group: ${{ github.workflow }}-", 1)
		}

		return content
	}))
	require.NoError(t, err)
	require.Contains(t, problems, ".github/workflows/codeql.yml: concurrency group is named after the caller (github.workflow)")
}

// @scenario "The checks main requires keep reporting"
func TestPRWorkflowReportsARequiredCheckLeftUnposted(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, func(name, content string) string {
		if name == PRWorkflowFile {
			content = strings.Replace(content, "            typecheck=${{ needs.app.result }}\n", "", 1)
			return strings.Replace(content, "success | skipped)", "success)", 1)
		}

		return content
	}))
	require.NoError(t, err)
	require.Len(t, problems, 2)
	require.Contains(t, problems[0], "ci-complete posts")
	require.Contains(t, problems, PRWorkflowFile+": ci-complete does not count a skipped call as passed")
}

// @scenario "A failed change check fails every check main requires"
func TestPRWorkflowReportsPassesPostedWhenChangesFailed(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, func(name, content string) string {
		if name == PRWorkflowFile {
			return strings.Replace(content, `; [ "$CHANGES" = success ] || state=failure`, "", 1)
		}

		return content
	}))
	require.NoError(t, err)
	require.Contains(t, problems, PRWorkflowFile+": ci-complete posts passes when changes failed and every call skipped")
}

// @scenario "The merge queue runs every product check"
func TestPRWorkflowReportsACheckTheMergeQueueSkips(t *testing.T) {
	problems, err := PRWorkflow(prTree(t, func(name, content string) string {
		if name == PRWorkflowFile {
			return strings.Replace(content, "steps.filter.outputs.mcp || steps.force.outputs.all", "steps.filter.outputs.mcp", 1)
		}

		return content
	}))
	require.NoError(t, err)
	require.Contains(t, problems, PRWorkflowFile+": changes output mcp is not forced true in the merge queue")
}
