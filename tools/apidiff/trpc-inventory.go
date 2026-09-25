package apidiff

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

//go:embed inventory/main-trpc.mjs inventory/branch-trpc.mjs
var inventoryScripts embed.FS

// Procedure is one tRPC procedure as either side declares it. Input and
// Output are JSON Schema, nil when the side declares none (main's outputs are
// mostly inferred, so nil there is normal).
type Procedure struct {
	Path   string         `json:"path"`
	Kind   string         `json:"kind"`
	Input  map[string]any `json:"input"`
	Output map[string]any `json:"output"`
	Source string         `json:"source"`
}

// ProcedureManifest is what one inventory script prints.
type ProcedureManifest struct {
	Side       string            `json:"side"`
	Procedures []Procedure       `json:"procedures"`
	Failures   []InventoryFailed `json:"failures,omitempty"`
}

// InventoryFailed is one contract file the branch script could not import.
type InventoryFailed struct {
	Source string `json:"source"`
	Error  string `json:"error"`
}

// inventoryLayout is where in a checkout the procedure script runs (beside the
// package whose node_modules resolve what it imports) and how: the monolith
// through its own tsx, a modular checkout through node's own type stripping,
// the way its applications run.
type inventoryLayout struct {
	script  string
	subdir  string
	command []string
}

// inventoryScriptName is the worktree-local, uncommitted file the script is
// written to and removed from after it runs.
const inventoryScriptName = ".apidiff-trpc-inventory.mjs"

// inventoryLayouts pick the script by what the checkout holds, not by which
// side it is, so a main that has itself become modular is read like the branch.
var inventoryLayouts = []struct {
	marker string
	layout inventoryLayout
}{
	{"packages/api/src/contract/trpc-contract.ts", inventoryLayout{script: "inventory/branch-trpc.mjs", subdir: "packages/api", command: []string{"node", "--experimental-transform-types"}}},
	{"platform/app/src/server/api/root.ts", inventoryLayout{script: "inventory/main-trpc.mjs", subdir: "platform/app", command: []string{"pnpm", "exec", "tsx"}}},
}

func detectInventoryLayout(dir string) (inventoryLayout, error) {
	for _, candidate := range inventoryLayouts {
		if _, err := os.Stat(filepath.Join(dir, candidate.marker)); err == nil {
			return candidate.layout, nil
		}
	}
	return inventoryLayout{}, fmt.Errorf("no tRPC declarations found in %s (looked for the contract builder and the monolith router)", dir)
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

// trpcInventory runs the procedure scripts: how commands run, the environment
// they inherit, and where their output streams.
type trpcInventory struct {
	run     runner
	inherit []string
	log     io.Writer
}

// collect writes the layout's script into dir, runs it, and reads the
// manifest it wrote to outFile. The script is removed afterwards whether or
// not it succeeded.
func (inventory trpcInventory) collect(ctx context.Context, dir, outFile string) (ProcedureManifest, error) {
	layout, err := detectInventoryLayout(dir)
	if err != nil {
		return ProcedureManifest{}, err
	}
	source, err := inventoryScripts.ReadFile(layout.script)
	if err != nil {
		return ProcedureManifest{}, err
	}
	workDir := filepath.Join(dir, layout.subdir)
	scriptPath := filepath.Join(workDir, inventoryScriptName)
	if err := os.WriteFile(scriptPath, source, 0o600); err != nil {
		return ProcedureManifest{}, err
	}
	defer os.Remove(scriptPath)
	spec := commandSpec{
		name: layout.command[0],
		args: append(append([]string{}, layout.command[1:]...), inventoryScriptName, outFile, dir),
		dir:  workDir,
		env:  append(append([]string{}, inventory.inherit...), placeholderDatastores...),
	}
	if err := inventory.run(ctx, spec, inventory.log); err != nil {
		return ProcedureManifest{}, fmt.Errorf("tRPC inventory in %s: %w", workDir, err)
	}
	return readProcedureManifest(outFile)
}

func readProcedureManifest(path string) (ProcedureManifest, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- a file this run just wrote under its work root
	if err != nil {
		return ProcedureManifest{}, err
	}
	var manifest ProcedureManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return ProcedureManifest{}, fmt.Errorf("tRPC inventory %s: %w", path, err)
	}
	return manifest, nil
}
