package ecrtag_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const goDockerfile = `# syntax=docker/dockerfile:1.7
FROM golang:1 AS build
COPY go.work go.work.sum ./
COPY cmd/go.* cmd/
COPY cmd/ cmd/
COPY pkg/ pkg/
RUN --mount=type=cache,target=/go/pkg/mod \
    # comments inside a continued RUN are dropped
    CGO_ENABLED=0 go build -ldflags="-s -w -X main.Version=${VERSION}" \
      -o /out/service ./cmd/service

FROM python:3 AS sandbox
COPY sdks/python/ /tmp/sdk/
RUN --mount=type=bind,source=infra/docker/prune.sh,target=/tmp/prune.sh sh /tmp/prune.sh

FROM distroless
COPY --from=build /out/service /service
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/
`

func goTree() ecrtag.Tree {
	return ecrtag.Tree{
		"go.work": "w1", "go.work.sum": "w2", ".dockerignore": "di",
		"infra/docker/Dockerfile.go": "df", "infra/docker/prune.sh": "pr",
		"cmd/go.mod": "m1", "cmd/go.sum": "s1",
		"cmd/service/main.go": "c1", "cmd/ciguard/main.go": "c2",
		"pkg/go.mod": "m2", "pkg/clog/clog.go": "p1", "pkg/ciscan/scan.go": "p2",
		"sdks/python/langwatch/__init__.py": "py",
		"docs/readme.md":                    "doc",
	}
}

// fakeGoDeps is cmd/service importing pkg/clog, from the context root.
func fakeGoDeps(_ context.Context, dir, pkg string) ([]string, error) {
	if dir != "." || pkg != "./cmd/service" {
		return nil, errors.New("unexpected go build " + dir + " " + pkg)
	}

	return []string{"cmd/service/main.go", "pkg/clog/clog.go"}, nil
}

func inputsOf(tree ecrtag.Tree, dockerfile string) ecrtag.Inputs {
	return ecrtag.Inputs{
		Tree:   tree,
		Read:   func(string) (string, error) { return dockerfile, nil },
		GoDeps: fakeGoDeps,
	}
}

// @scenario "A Go image reads only the packages its binary builds from"
func TestAGoStageReadsOnlyThePackagesItBuilds(t *testing.T) {
	files, err := inputsOf(goTree(), goDockerfile).Files(context.Background(), "infra/docker/Dockerfile.go")
	require.NoError(t, err)

	assert.Equal(t, []string{
		".dockerignore", "cmd/go.mod", "cmd/go.sum", "cmd/service/main.go",
		"go.work", "go.work.sum", "infra/docker/Dockerfile.go", "infra/docker/prune.sh",
		"pkg/clog/clog.go", "pkg/go.mod",
		"sdks/python/langwatch/__init__.py",
	}, files, "a CI tool in cmd/ and a package the binary does not import are not inputs; a non-Go stage reads all it copies")
}

// @scenario "A .dockerignore change rebuilds every image"
func TestTheHashFollowsTheInputsAlone(t *testing.T) {
	ctx := context.Background()
	hash := func(tree ecrtag.Tree, image string) string {
		h, err := inputsOf(tree, goDockerfile).Hash(ctx, image, "infra/docker/Dockerfile.go")
		require.NoError(t, err)
		return h
	}
	base := hash(goTree(), "gateway")
	changed := func(path, blob string) ecrtag.Tree {
		tree := goTree()
		tree[path] = blob
		return tree
	}

	assert.Equal(t, base, hash(changed("cmd/ciguard/main.go", "c2'"), "gateway"), "a CI tool")
	assert.Equal(t, base, hash(changed("pkg/ciscan/scan.go", "p2'"), "gateway"), "a package the binary does not import")
	assert.Equal(t, base, hash(changed("docs/readme.md", "doc'"), "gateway"), "a file nothing copies")
	assert.NotEqual(t, base, hash(changed("pkg/clog/clog.go", "p1'"), "gateway"), "a shared package the binary imports")
	assert.NotEqual(t, base, hash(changed("pkg/go.sum", "s2"), "gateway"), "a module's go.sum")
	assert.NotEqual(t, base, hash(changed(".dockerignore", "di'"), "gateway"), ".dockerignore")
	assert.NotEqual(t, base, hash(changed("infra/docker/Dockerfile.go", "df'"), "gateway"), "the Dockerfile")
	assert.NotEqual(t, base, hash(changed("infra/docker/prune.sh", "pr'"), "gateway"), "a bind-mounted script")
	assert.NotEqual(t, base, hash(goTree(), "nlp"), "another image built from the same Dockerfile")
}

func TestAStageWithoutGoReadsEveryFileItCopies(t *testing.T) {
	dockerfile := "FROM node\nCOPY pkg ./pkg\nCOPY cmd/go.* cmd/\n"
	files, err := inputsOf(goTree(), dockerfile).Files(context.Background(), "infra/docker/Dockerfile.go")
	require.NoError(t, err)

	assert.Contains(t, files, "pkg/ciscan/scan.go")
	assert.Contains(t, files, "cmd/go.sum")
	assert.NotContains(t, files, "cmd/ciguard/main.go", "cmd/go.* names files, not the directory")
}

func TestAGoBuildAfterCdReadsFromThatDirectory(t *testing.T) {
	var asked []string
	in := inputsOf(goTree(), "FROM golang\nCOPY pkg ./pkg\nRUN cd pkg && go build -o /out/x ./clog\n")
	in.GoDeps = func(_ context.Context, dir, pkg string) ([]string, error) {
		asked = append(asked, dir+" "+pkg)
		return []string{"pkg/clog/clog.go"}, nil
	}
	files, err := in.Files(context.Background(), "infra/docker/Dockerfile.go")
	require.NoError(t, err)

	assert.Equal(t, []string{"pkg ./clog"}, asked)
	assert.NotContains(t, files, "pkg/ciscan/scan.go")
}

// @scenario "An image whose inputs cannot be read is rebuilt"
func TestWhatItCannotReadFails(t *testing.T) {
	for name, dockerfile := range map[string]string{
		"a go build of an import path": "FROM golang\nCOPY cmd/ cmd/\nRUN go build github.com/x/y\n",
		"a cd that leaves the context": "FROM golang\nCOPY cmd/ cmd/\nRUN cd /src && go build ./cmd/service\n",
		"a source that names no file":  "FROM node\nCOPY missing/ ./\n",
		"a variable in a source":       "FROM node\nARG DIR\nCOPY ${DIR} ./\n",
		"a heredoc":                    "FROM node\nRUN <<EOF\necho hi\nEOF\n",
		"a COPY with no destination":   "FROM node\nCOPY pkg\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, err := inputsOf(goTree(), dockerfile).Files(context.Background(), "infra/docker/Dockerfile.go")
			assert.Error(t, err)
		})
	}
	t.Run("go list fails", func(t *testing.T) {
		in := inputsOf(goTree(), goDockerfile)
		in.GoDeps = func(context.Context, string, string) ([]string, error) { return nil, errors.New("no go") }
		_, err := in.Files(context.Background(), "infra/docker/Dockerfile.go")
		assert.Error(t, err)
	})
}

func TestGlobsAndJSONFormSources(t *testing.T) {
	tree := ecrtag.Tree{
		"modules/catalog/model-catalog.json": "a", "modules/catalog/model-catalog.overlay.json": "b",
		"modules/catalog/other.json": "c", "Dockerfile": "d",
	}
	in := inputsOf(tree, "FROM x\nCOPY [\"modules/catalog/model-catalog*.json\", \"/dst/\"]\n")
	files, err := in.Files(context.Background(), "Dockerfile")
	require.NoError(t, err)

	assert.Equal(t, []string{"Dockerfile", "modules/catalog/model-catalog.json", "modules/catalog/model-catalog.overlay.json"}, files)
}
