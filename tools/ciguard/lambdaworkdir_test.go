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
	writeDockerfile(t, root, "Dockerfile.engine.lambda", dockerfile)

	return root
}

// goRepo holds one Dockerfile that builds a Lambda image as a stage.
func goRepo(t *testing.T, dockerfile string) string {
	t.Helper()

	root := t.TempDir()
	writeDockerfile(t, root, "Dockerfile.go-services", dockerfile)

	return root
}

func writeDockerfile(t *testing.T, root, name, dockerfile string) {
	t.Helper()

	path := filepath.Join(root, "infra", "docker", name)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(dockerfile), 0o600))
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

	t.Run("when a lambda stage starts where the stage it builds on does, it passes", func(t *testing.T) {
		root := goRepo(t, "FROM gcr.io/distroless/python3-debian12:nonroot AS service\nWORKDIR /\nFROM service AS lambda\nCMD [\"nlpgo\"]\nFROM service AS nlp\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		assert.Empty(t, problems)
	})

	t.Run("when a lambda stage builds on a stage that sets no WORKDIR, it is refused", func(t *testing.T) {
		root := goRepo(t, "FROM golang AS build\nWORKDIR /src\nFROM gcr.io/distroless/python3-debian12:nonroot AS service\nFROM service AS lambda\nFROM service AS gateway\nWORKDIR /\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "Dockerfile.go-services")
		assert.Contains(t, problems[0], "sets no WORKDIR")
	})

	t.Run("when a Dockerfile builds no Lambda image, its WORKDIR is not checked", func(t *testing.T) {
		root := lambdaRepo(t, "FROM gcr.io/distroless/python3-debian12:nonroot\nWORKDIR /\n")
		writeDockerfile(t, root, "Dockerfile.go-services", "FROM gcr.io/distroless/static:nonroot AS gateway\n")

		problems, err := ciguard.LambdaWorkdir(root)

		require.NoError(t, err)
		assert.Empty(t, problems)
	})

	t.Run("when no Lambda Dockerfile exists, it says the glob matched nothing", func(t *testing.T) {
		problems, err := ciguard.LambdaWorkdir(t.TempDir())

		require.NoError(t, err)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], ciguard.LambdaDockerfileGlob)
	})
}
