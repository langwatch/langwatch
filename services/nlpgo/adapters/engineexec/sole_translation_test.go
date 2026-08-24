package engineexec_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestEngineExecIsTheOnlyTranslation fails when a harness hand-copies the
// engine-to-app translation instead of driving engineexec.
//
// The package doc claims this package is the only translation, and the claim is
// what makes it safe to add a request field here and nowhere else. It was false
// once already: six provider harnesses each defined their own
// live<Provider>ExecutorAdapter, and every one of them dropped UntilNodeID, the
// api-key context and seven other request fields. A harness that mistranslates
// the request cannot fail on a translation bug, so those suites were blind to
// exactly the defect this package exists to prevent, while the doc told the
// next maintainer there was only one place to look.
//
// Prose cannot hold that line. This can.
func TestEngineExecIsTheOnlyTranslation(t *testing.T) {
	root := filepath.Join("..", "..")

	// The walk only collects names. Reading inside the callback is what gosec
	// G122 flags, since the path can change under a symlink between the two.
	candidates, err := goFilesUnder(root)
	require.NoError(t, err)

	var offenders []string
	for _, path := range candidates {
		// This package IS the translation.
		if strings.Contains(filepath.ToSlash(path), "adapters/engineexec/") {
			continue
		}
		src, err := os.ReadFile(path)
		require.NoError(t, err)
		// The signature of a hand-rolled executor: it satisfies
		// app.WorkflowExecutor by parsing workflow JSON itself.
		text := string(src)
		if strings.Contains(text, "dsl.ParseWorkflow") &&
			strings.Contains(text, "engine.ExecuteRequest{") {
			offenders = append(offenders, path)
		}
	}

	require.Empty(t, offenders,
		"these files translate an app request into an engine request themselves; "+
			"call engineexec.New(eng) instead, so a new request field is added in one place")
}

// TestTheGuardCanFail keeps the check above from passing because it scans
// nothing. A guard that walks an empty tree reads exactly like a clean one.
func TestTheGuardCanFail(t *testing.T) {
	files, err := goFilesUnder(filepath.Join("..", ".."))
	require.NoError(t, err)
	require.Greater(t, len(files), 100, "the guard above scanned almost nothing")
}

// goFilesUnder lists every .go file under root, names only.
func goFilesUnder(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".go") {
			files = append(files, path)
		}
		return nil
	})
	return files, err
}
