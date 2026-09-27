package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
)

// ServedRoute is one METHOD path a side's HTTP application answers, in its
// router's own spelling (Hono's ":param"), documented or not. Method is
// upper case; ALL answers any method.
type ServedRoute struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Source string `json:"source"`
}

// RouteManifest is what one route inventory script prints.
type RouteManifest struct {
	Side     string            `json:"side"`
	Routes   []ServedRoute     `json:"routes"`
	Failures []InventoryFailed `json:"failures,omitempty"`
}

// routeScriptName is the worktree-local, uncommitted file the route script is
// written to and removed from after it runs.
const routeScriptName = ".apidiff-routes-inventory.mjs"

// routeLayouts read the monolith's built Hono router, or a modular checkout's
// installed server modules and the API application's own lanes.
var routeLayouts = []inventoryCandidate{
	{"packages/installed-server-modules/src/server-modules.generated.ts", inventoryLayout{script: "inventory/branch-routes.mjs", subdir: "packages/api", command: []string{"node", "--experimental-transform-types"}}},
	{"platform/app/src/server/api-router.ts", inventoryLayout{script: "inventory/main-routes.mjs", subdir: "platform/app", command: []string{"pnpm", "exec", "tsx"}}},
}

// routeInventory runs the served-route scripts.
type routeInventory scriptInventory

// collect runs the layout's route script in dir and reads the manifest it
// wrote to outFile.
func (inventory routeInventory) collect(ctx context.Context, dir, outFile string) (RouteManifest, error) {
	layout, ok := detectLayout(dir, routeLayouts)
	if !ok {
		return RouteManifest{}, fmt.Errorf("no served routes found in %s (looked for the installed server modules and the monolith API router)", dir)
	}
	job := inventoryJob{layout: layout, dir: dir, scriptName: routeScriptName, outFile: outFile}
	if err := scriptInventory(inventory).runScript(ctx, job); err != nil {
		return RouteManifest{}, err
	}
	data, err := readInventoryFile(outFile)
	if err != nil {
		return RouteManifest{}, err
	}
	var manifest RouteManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return RouteManifest{}, fmt.Errorf("route inventory %s: %w", outFile, err)
	}
	return manifest, nil
}
