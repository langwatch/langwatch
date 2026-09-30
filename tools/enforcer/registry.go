// Package enforcer is the Go front of the architecture enforcer. It holds the
// TS registry (packages/architecture-enforcer/src/policies/index.ts) id for
// id; a policy with a Go Run is computed here, the rest are delegated to the
// TS CLI in one process, and both halves are reported as one run.
package enforcer

import "github.com/langwatch/langwatch/tools/internal/workspace"

// Violation is a finding in the TS enforcer's shape.
type Violation = workspace.Violation

// Policy is one registry entry. Run is nil while the policy lives in TS.
type Policy struct {
	ID, Spec string
	Run      func(*workspace.Snapshot) ([]Violation, error)
}

const (
	featurePackageBoundaries = "specs/feature-package-boundaries.feature"
	strictFeatureLayout      = "specs/strict-feature-layout.feature"
	deadCodeGuards           = "specs/dead-code-guards.feature"
	frontendBoundaries       = "specs/frontend-feature-boundaries.feature"
)

// Policies is the registry, in the TS registry's order.
var Policies = []Policy{
	{ID: "feature-layout", Spec: strictFeatureLayout},
	{ID: "feature-shape", Spec: strictFeatureLayout},
	{ID: "unused-module-export", Spec: deadCodeGuards, Run: UnusedModuleExports},
	{ID: "memory-twin-drift", Spec: deadCodeGuards},
	{ID: "source-folder-shape", Spec: "specs/source-folder-shape.feature"},
	{ID: "feature-configuration", Spec: featurePackageBoundaries},
	{ID: "prisma-table-ownership", Spec: featurePackageBoundaries},
	{ID: "clickhouse-table-ownership", Spec: "specs/tooling/lint-clickhouse-table-ownership.feature"},
	{ID: "prisma-migration-access", Spec: featurePackageBoundaries},
	{ID: "browser-node-leak", Spec: "specs/tooling/lint-browser-node-leak.feature", Run: BrowserNodeLeaks},
	{ID: "browser-package-closure", Spec: frontendBoundaries},
	{ID: "browser-package-exports", Spec: frontendBoundaries},
	{ID: "browser-kit-exports", Spec: frontendBoundaries},
	{ID: "browser-kit-dependencies", Spec: frontendBoundaries},
	{ID: "architecture-records", Spec: featurePackageBoundaries},
	{ID: "default-test-lane", Spec: "specs/tooling/default-test-lane.feature"},
	{ID: "contract-build-config", Spec: featurePackageBoundaries, Run: ContractBuildConfigs},
	{ID: "declaration-project-references", Spec: featurePackageBoundaries, Run: DeclarationProjectReferences},
	{ID: "manifests", Spec: featurePackageBoundaries},
	{ID: "application-boundaries", Spec: featurePackageBoundaries},
	{ID: "service-projection-boundaries", Spec: featurePackageBoundaries},
	{ID: "service-ceilings", Spec: featurePackageBoundaries},
	{ID: "cycles", Spec: featurePackageBoundaries, Run: Cycles},
	{ID: "peer-cycles", Spec: "specs/peer-cycles.feature"},
	{ID: "eventing-table-access", Spec: "specs/eventing-table-access.feature"},
	{ID: "declarations", Spec: featurePackageBoundaries},
	{ID: "workspace-seams", Spec: "specs/workspace-seams.feature"},
	{ID: "composed-exports", Spec: "specs/api-package-surface.feature"},
}
