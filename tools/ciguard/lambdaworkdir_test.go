package ciguard_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ciguard"
)

func lambdaRepo(t *testing.T, dockerfile string) string {
	t.Helper()

	root := t.TempDir()
	path := filepath.Join(root, "infra", "docker", "Dockerfile.engine.lambda")
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(dockerfile), 0o600))

	return root
}

// @scenario "A Lambda image starts in a directory Lambda's own user can enter"
func TestLambdaWorkdir(t *testing.T) {
	t.Run("when the runtime stage starts from /, it passes", func(t *testing.T) {
		root := lambdaRepo(t, "FROM golang AS build\nWORKDIR /src\nFROM gcr.io/distroless/python3-debian12:nonroot\nWORKDIR /\nENTRYPOINT [\"/service\"]\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		assert.Empty(t, problems)
	})

	t.Run("when only a build stage sets WORKDIR, the runtime stage is refused", func(t *testing.T) {
		root := lambdaRepo(t, "FROM golang AS build\nWORKDIR /src\nFROM gcr.io/distroless/python3-debian12:nonroot\nENTRYPOINT [\"/service\"]\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "Dockerfile.engine.lambda")
		assert.Contains(t, problems[0], "sets no WORKDIR")
	})

	t.Run("when the runtime stage starts under /home, it is refused", func(t *testing.T) {
		root := lambdaRepo(t, "FROM gcr.io/distroless/python3-debian12:nonroot\nworkdir /home/nonroot\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "/home/nonroot")
	})

	t.Run("when no Lambda Dockerfile exists, it says the glob matched nothing", func(t *testing.T) {
		problems, err := ciguard.LambdaWorkdir(t.TempDir())

		require.NoError(t, err)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], ciguard.LambdaDockerfileGlob)
	})
}
