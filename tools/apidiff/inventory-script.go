package apidiff

import (
	"context"
	"embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

//go:embed inventory/main-trpc.mjs inventory/branch-trpc.mjs inventory/main-routes.mjs inventory/branch-routes.mjs
var inventoryScripts embed.FS

// inventoryLayout is where in a checkout an inventory script runs (beside the
// package whose node_modules resolve what it imports) and how: the monolith
// through its own tsx, a modular checkout through node's own type stripping,
// the way its applications run.
type inventoryLayout struct {
	script  string
	subdir  string
	command []string
}

// inventoryCandidate picks a layout by a file the checkout holds, not by which
// side it is, so a main that has itself become modular is read like the branch.
type inventoryCandidate struct {
	marker string
	layout inventoryLayout
}

// detectLayout is the first candidate whose marker the checkout holds.
func detectLayout(dir string, candidates []inventoryCandidate) (inventoryLayout, bool) {
	for _, candidate := range candidates {
		if _, err := os.Stat(filepath.Join(dir, candidate.marker)); err == nil {
			return candidate.layout, true
		}
	}
	return inventoryLayout{}, false
}

// placeholderDatastores points every datastore URL the imports might read at a
// closed port, so importing a router can never reach a developer's data.
var placeholderDatastores = []string{
	"SKIP_ENV_VALIDATION=1",
	"BUILD_TIME=1",
	"DATABASE_URL=postgresql://apidiff:apidiff@127.0.0.1:1/apidiff_inventory",
	"REDIS_URL=redis://127.0.0.1:1/0",
	"CLICKHOUSE_URL=http://127.0.0.1:1/apidiff_inventory",
}

// scriptInventory runs the inventory scripts: how commands run, the
// environment they inherit, and where their output streams.
type scriptInventory struct {
	run     runner
	inherit []string
	log     io.Writer
}

// inventoryJob is one script run: the layout, the checkout, the worktree-local
// name the script is written under, and the file it writes its manifest to.
type inventoryJob struct {
	layout     inventoryLayout
	dir        string
	scriptName string
	outFile    string
}

// runScript writes the job's script into the checkout, runs it, and removes
// it afterwards whether or not it succeeded.
func (inventory scriptInventory) runScript(ctx context.Context, job inventoryJob) error {
	source, err := inventoryScripts.ReadFile(job.layout.script)
	if err != nil {
		return err
	}
	workDir := filepath.Join(job.dir, job.layout.subdir)
	scriptPath := filepath.Join(workDir, job.scriptName)
	if err := os.WriteFile(scriptPath, source, 0o600); err != nil {
		return err
	}
	defer os.Remove(scriptPath)
	command := job.layout.command
	spec := commandSpec{
		name: command[0],
		args: append(append([]string{}, command[1:]...), job.scriptName, job.outFile, job.dir),
		dir:  workDir,
		env:  append(append([]string{}, inventory.inherit...), placeholderDatastores...),
	}
	if err := inventory.run(ctx, spec, inventory.log); err != nil {
		return fmt.Errorf("inventory %s in %s: %w", job.scriptName, workDir, err)
	}
	return nil
}

// readInventoryFile is a manifest a script this run started just wrote.
func readInventoryFile(path string) ([]byte, error) {
	return os.ReadFile(path) // #nosec G304 -- a file this run just wrote under its work root
}
