package engineexec_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// engineRequestRef matches a reference to the engine's request type in any
// construction form.
//
// It deliberately does NOT require a following `{`, and does not also require
// dsl.ParseWorkflow. The first version required both, which made the guard
// narrower than the claim it exists to hold: a file that built the request from
// an already-parsed workflow, or wrote `var req engine.ExecuteRequest` and then
// assigned fields, or put a space before the brace, all satisfied the claim's
// prohibition and stayed green. The whitespace allowance covers `engine . ExecuteRequest`,
// which gofmt would not produce but a regex should not depend on gofmt.
//
// The cost is that naming the type in a comment counts too. That is the right
// side to err on for a boundary this small, and the failure names the file, so
// a mention in prose is one glance to dismiss.
var engineRequestRef = regexp.MustCompile(`\bengine\s*\.\s*ExecuteRequest\b`)

// TestEngineExecIsTheOnlyTranslation fails when a file outside this package
// builds an engine.ExecuteRequest of its own.
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
	candidates, err := goFilesUnder(filepath.Join("..", ".."))
	require.NoError(t, err)

	var offenders []string
	for _, path := range candidates {
		// This package IS the translation.
		if strings.Contains(filepath.ToSlash(path), "adapters/engineexec/") {
			continue
		}
		// The engine package owns the type and names it unqualified, so it
		// cannot match; this skip only keeps the intent readable.
		if strings.Contains(filepath.ToSlash(path), "/app/engine/") {
			continue
		}
		src, err := os.ReadFile(path)
		require.NoError(t, err)
		if engineRequestRef.MatchString(string(src)) {
			offenders = append(offenders, path)
		}
	}

	require.Empty(t, offenders,
		"these files name engine.ExecuteRequest outside the one package allowed to build it; "+
			"call engineexec.New(eng) instead, so a new request field is added in one place")
}

// TestTheGuardCatchesEveryConstructionForm pins the guard against the shapes it
// used to miss.
//
// This exists because the mutation that first justified the guard, restoring one
// of the six deleted adapters, only proved it caught the exact shape it was
// written for. All six carried the same two tokens. A guard tested only against
// the code it was written from is tested against nothing.
func TestTheGuardCatchesEveryConstructionForm(t *testing.T) {
	caught := map[string]string{
		"a composite literal":            `x := engine.ExecuteRequest{Workflow: wf}`,
		"a space before the brace":       `x := engine.ExecuteRequest {Workflow: wf}`,
		"a var and field assignment":     "var req engine.ExecuteRequest\nreq.Workflow = wf",
		"a pointer":                      `x := &engine.ExecuteRequest{}`,
		"a return type":                  "func mk() engine.ExecuteRequest { return mk2() }",
		"a parameter type":               "func run(r engine.ExecuteRequest) {}",
		"no dsl.ParseWorkflow in sight":  `run(engine.ExecuteRequest{Workflow: alreadyParsed})`,
		"whitespace around the selector": `x := engine . ExecuteRequest{}`,
	}
	for name, src := range caught {
		t.Run(name, func(t *testing.T) {
			require.True(t, engineRequestRef.MatchString(src), "should have been caught")
		})
	}

	ignored := map[string]string{
		"a different type on the same package": `x := engine.ExecuteStreamOptions{}`,
		"a longer identifier":                  `x := engine.ExecuteRequestBuilder{}`,
		"another package's same-named type":    `x := other.ExecuteRequest{}`,
	}
	for name, src := range ignored {
		t.Run(name, func(t *testing.T) {
			require.False(t, engineRequestRef.MatchString(src), "should not have been caught")
		})
	}
}

// TestTheGuardScansTheRepo keeps the check above from passing because it walked
// nothing. A guard over an empty tree reads exactly like a clean one.
func TestTheGuardScansTheRepo(t *testing.T) {
	files, err := goFilesUnder(filepath.Join("..", ".."))
	require.NoError(t, err)
	require.Greater(t, len(files), 100, "the guard above scanned almost nothing")
}

// goFilesUnder lists every .go file under root, names only.
//
// Names only, because reading inside the walk callback is what gosec G122
// flags: the path can change under a symlink between the walk and the read.
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
