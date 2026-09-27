package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
)

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

// InventoryFailed is one contract file or module the branch script could not read.
type InventoryFailed struct {
	Source string `json:"source"`
	Error  string `json:"error"`
}

// inventoryScriptName is the worktree-local, uncommitted file the procedure
// script is written to and removed from after it runs.
const inventoryScriptName = ".apidiff-trpc-inventory.mjs"

var inventoryLayouts = []inventoryCandidate{
	{"packages/api/src/contract/trpc-contract.ts", inventoryLayout{script: "inventory/branch-trpc.mjs", subdir: "packages/api", command: []string{"node", "--experimental-transform-types"}}},
	{"platform/app/src/server/api/root.ts", inventoryLayout{script: "inventory/main-trpc.mjs", subdir: "platform/app", command: []string{"pnpm", "exec", "tsx"}}},
}

func detectInventoryLayout(dir string) (inventoryLayout, error) {
	layout, ok := detectLayout(dir, inventoryLayouts)
	if !ok {
		return inventoryLayout{}, fmt.Errorf("no tRPC declarations found in %s (looked for the contract builder and the monolith router)", dir)
	}
	return layout, nil
}

// trpcInventory runs the procedure scripts.
type trpcInventory scriptInventory

// collect runs the layout's procedure script in dir and reads the manifest it
// wrote to outFile.
func (inventory trpcInventory) collect(ctx context.Context, dir, outFile string) (ProcedureManifest, error) {
	layout, err := detectInventoryLayout(dir)
	if err != nil {
		return ProcedureManifest{}, err
	}
	job := inventoryJob{layout: layout, dir: dir, scriptName: inventoryScriptName, outFile: outFile}
	if err := scriptInventory(inventory).runScript(ctx, job); err != nil {
		return ProcedureManifest{}, err
	}
	return readProcedureManifest(outFile)
}

func readProcedureManifest(path string) (ProcedureManifest, error) {
	data, err := readInventoryFile(path)
	if err != nil {
		return ProcedureManifest{}, err
	}
	var manifest ProcedureManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return ProcedureManifest{}, fmt.Errorf("tRPC inventory %s: %w", path, err)
	}
	return manifest, nil
}
