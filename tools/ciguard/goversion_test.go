package ciguard_test

import (
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

// agreeingRepo is the smallest tree the go-version guard reads: a root
// module, a workspace, one Dockerfile and one workflow, all in agreement.
func agreeingRepo(t *testing.T, overrides map[string]string) string {
	t.Helper()

	files := map[string]string{
		"go.mod":                       "module x\n\ngo 1.26.5\n",
		"go.work":                      "go 1.26.5\n\nuse (\n\t.\n)\n",
		"infra/docker/Dockerfile.svc":  "FROM --platform=$BUILDPLATFORM golang:1.26.5-alpine AS build\n",
		".github/workflows/go-ci.yaml": "jobs:\n  build:\n    steps:\n      - uses: actions/setup-go@v7\n        with:\n          go-version-file: go.mod\n",
	}
	maps.Copy(files, overrides)

	root := t.TempDir()
	for path, body := range files {
		full := filepath.Join(root, path)
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte(body), 0o600))
	}

	return root
}

// @scenario "Every non-exempt Go toolchain reference in the repo agrees"
func TestGoVersionAcceptsAnAgreeingRepo(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, nil))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "The workspace and the root module must agree"
func TestGoVersionReportsAWorkspaceOnADifferentVersion(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		"go.work": "go 1.26.1\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "go.work says 1.26.1")
}

// @scenario "A Dockerfile built with a different Go than the module fails the check"
func TestGoVersionReportsADockerfileOnADifferentPatch(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		"infra/docker/Dockerfile.svc": "FROM golang:1.26.1-alpine AS build\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "builds with Go 1.26.1, go.mod says 1.26.5")
}

// @scenario "A floating Go base image fails the check"
func TestGoVersionRejectsAFloatingBaseImage(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		"infra/docker/Dockerfile.svc": "FROM golang:1.26-alpine AS build\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "floating tag")
}

// @scenario "A workflow pinning Go with a literal fails the check"
func TestGoVersionReportsAWorkflowPinningALiteral(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		".github/workflows/go-ci.yaml": "jobs:\n  build:\n    steps:\n      - uses: actions/setup-go@v7\n        with:\n          go-version: '1.25'\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "pins Go with a literal")
}

// @scenario "A child module on a different version fails the check"
func TestGoVersionReportsAChildModuleOnADifferentVersion(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		"infra/clickhouse-serverless/go.mod": "module y\n\ngo 1.26.1\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "infra/clickhouse-serverless/go.mod declares Go 1.26.1")
}

// @scenario "The published SDK keeps its own floor"
//
// Asserts the exemption CHANGES the outcome. The previous version of this
// test read the reason string out of the map and asserted it contained the
// word "floor" — which passed whether or not GoVersion consulted the map at
// all, and it did not: child modules were never scanned.
func TestGoVersionExemptsThePublishedSDKFromTheRootVersion(t *testing.T) {
	root := agreeingRepo(t, map[string]string{
		"sdks/go/go.mod": "module sdk\n\ngo 1.25.0\n",
	})

	problems, err := ciguard.GoVersion(root)

	require.NoError(t, err)
	assert.Empty(t, problems, "the SDK's floor is exempt and must not be reported")

	reason, ok := ciguard.ExemptModules["sdks/go/go.mod"]
	require.True(t, ok)
	assert.Contains(t, strings.ToLower(reason), "floor", "an exemption must record why")
}

// @scenario "A workflow that sets up Go without naming a module fails the check"
func TestGoVersionReportsSetupGoWithoutAVersionFile(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		".github/workflows/go-ci.yaml": "jobs:\n  build:\n    steps:\n      - uses: actions/setup-go@v7\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "without go-version-file")
}

// @scenario "A lowercase or indented FROM is still checked"
func TestGoVersionChecksALowercaseFromInstruction(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		"infra/docker/Dockerfile.svc": "  from golang:1.26.1-alpine AS build\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "builds with Go 1.26.1")
}

func TestGoVersionHoldsInTheLiveRepo(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.GoVersion(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}
