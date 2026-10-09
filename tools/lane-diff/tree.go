package lanediff

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
)

// excludedRoots are top-level directories no worker image loads.
var excludedRoots = []string{"sdks/", "docs/", "mcp/", "services/", "tools/", "dev/", "specs/", "skills/", "plugins/", "infra/", "cmd/", "pkg/"}

// excludedParts mark tests, build output and the builders' own source.
var excludedParts = []string{
	"/__tests__/", "/__mocks__/", "/node_modules/", "/dist/", "/e2e/", "/fixtures/", "/tests/", "/test/",
	".test.ts", ".spec.ts", ".d.ts", ".stories.ts",
	"platform/app/src/server/event-sourcing/pipeline/", "packages/eventing/src/pipeline/",
	"platform/app/src/server/event-sourcing/services/", "packages/eventing/src/services/",
}

// Included reports whether a path is worker-loadable TypeScript.
func Included(path string) bool {
	if !strings.HasSuffix(path, ".ts") {
		return false
	}
	for _, root := range excludedRoots {
		if strings.HasPrefix(path, root) {
			return false
		}
	}
	for _, part := range excludedParts {
		if strings.Contains("/"+path, part) {
			return false
		}
	}
	return true
}

// repo runs git in one repository.
type repo struct {
	ctx  context.Context
	root string
}

// git runs one git subcommand and returns its standard output.
func (r repo) git(stdin io.Reader, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(r.ctx, "git", append([]string{"-C", r.root}, args...)...) //nolint:gosec // argv array, no shell; fixed git subcommands with operator-chosen refs
	cmd.Stdin = stdin
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

// ReadTree reads every included file at ref, comments blanked.
func ReadTree(ctx context.Context, root, ref string) (Tree, error) {
	r := repo{ctx: ctx, root: root}
	list, err := r.git(nil, "ls-tree", "-r", "-z", "--name-only", ref)
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, path := range strings.Split(string(list), "\x00") {
		if Included(path) {
			paths = append(paths, path)
		}
	}
	var input bytes.Buffer
	for _, path := range paths {
		fmt.Fprintf(&input, "%s:%s\n", ref, path)
	}
	blobs, err := r.git(&input, "cat-file", "--batch")
	if err != nil {
		return nil, err
	}
	return splitBatch(bufio.NewReader(bytes.NewReader(blobs)), paths)
}

// splitBatch reads `git cat-file --batch` output, one object per path.
func splitBatch(reader *bufio.Reader, paths []string) (Tree, error) {
	tree := Tree{}
	for _, path := range paths {
		header, err := reader.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("git cat-file %s: %w", path, err)
		}
		fields := strings.Fields(header)
		if len(fields) < 3 {
			continue
		}
		size, err := strconv.Atoi(fields[2])
		if err != nil {
			return nil, fmt.Errorf("git cat-file header %q: %w", header, err)
		}
		body := make([]byte, size+1)
		if _, err := io.ReadFull(reader, body); err != nil {
			return nil, err
		}
		tree[path] = stripComments(string(body[:size]))
	}
	return tree, nil
}
