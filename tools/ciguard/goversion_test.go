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

// @scenario "Every Go toolchain reference in the repo agrees"
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

// @scenario "A workflow states the version by reading the module"
func TestGoVersionReportsAWorkflowPinningALiteral(t *testing.T) {
	problems, err := ciguard.GoVersion(agreeingRepo(t, map[string]string{
		".github/workflows/go-ci.yaml": "jobs:\n  build:\n    steps:\n      - uses: actions/setup-go@v7\n        with:\n          go-version: '1.25'\n",
	}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "pins Go with a literal")
}

// @scenario "The published SDK keeps its own floor"
func TestGoVersionExemptsThePublishedSDKWithAReason(t *testing.T) {
	reason, ok := ciguard.ExemptModules["sdks/go/go.mod"]

	require.True(t, ok, "the SDK's deliberate floor must be recorded as an exemption")
	assert.Contains(t, strings.ToLower(reason), "floor")
}

func TestGoVersionHoldsInTheLiveRepo(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.GoVersion(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}
