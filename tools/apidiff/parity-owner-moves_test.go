package apidiff

import (
	"strings"
	"testing"
)

// namespaceOwner reads a branch contract's module, else maps main's namespace
// the way the catalog would.
func namespaceOwner(owners map[string]string) func(Procedure) string {
	return func(procedure Procedure) string {
		if module := contractModule(procedure.Source); module != "" {
			return module
		}
		namespace, _ := splitProcedurePath(procedure.Path)
		if module, ok := owners[namespace]; ok {
			return module
		}
		return unownedModule
	}
}

func organizationInput() map[string]any {
	return objectInput(map[string]any{"organizationId": stringProperty()}, "organizationId")
}

func TestACrossModuleMoveIsARuledOwnerMove(t *testing.T) {
	main := []Procedure{{Path: "user.personalUsage", Kind: "query", Input: organizationInput(), Source: "platform/app/src/server/api/routers/user.ts"}}
	branch := []Procedure{{Path: "governance.personalUsage", Kind: "query", Input: organizationInput(), Source: "enterprise/modules/governance/contract/src/governance.trpc.ts"}}
	parity := DiffProcedures(main, branch, namespaceOwner(map[string]string{"user": "user"}))
	if len(parity.Missing) != 0 || len(parity.Extra) != 0 || len(parity.Moved) != 0 || len(parity.Breaking) != 0 {
		t.Fatalf("parity = %+v, want the move settled", parity)
	}
	want := ProcedurePair{Main: "user.personalUsage", Branch: "governance.personalUsage", Module: "governance", MainModule: "user", Reason: ownerMoveReason}
	if len(parity.OwnerMoves) != 1 || parity.OwnerMoves[0] != want {
		t.Fatalf("owner moves = %+v, want %+v", parity.OwnerMoves, want)
	}
	if changes := parity.TrpcChanges(); len(changes) != 0 {
		t.Errorf("changes = %+v, want no cause", changes)
	}
	report := ParityReport{Trpc: parity}
	for _, module := range []string{"governance", "user"} {
		if packet := renderPacket(report, module); !strings.Contains(packet, "main `user.personalUsage` (user) is served as branch `governance.personalUsage` (governance)") {
			t.Errorf("%s packet does not list the move:\n%s", module, packet)
		}
	}
}

func TestASameModuleNamespaceRenameStaysMissing(t *testing.T) {
	main := []Procedure{{Path: "auth.route", Kind: "query", Input: organizationInput(), Source: "platform/app/src/server/api/routers/auth.ts"}}
	branch := []Procedure{{Path: "frontDoor.route", Kind: "query", Input: organizationInput(), Source: "modules/auth/contract/src/front-door.trpc.ts"}}
	parity := DiffProcedures(main, branch, namespaceOwner(map[string]string{"auth": "auth"}))
	if len(parity.Missing) != 1 || len(parity.Extra) != 1 || len(parity.Moved) != 1 || len(parity.OwnerMoves) != 0 {
		t.Fatalf("parity = %+v, want auth.route missing with a candidate only", parity)
	}
}

func TestAnOwnerMoveStillComparesTheInput(t *testing.T) {
	main := []Procedure{{Path: "user.cliBootstrap", Kind: "query", Input: organizationInput(), Source: "main"}}
	narrowed := objectInput(map[string]any{"organizationId": map[string]any{"type": "integer"}}, "organizationId")
	branch := []Procedure{{Path: "gateway.cliBootstrap", Kind: "query", Input: narrowed, Source: "modules/gateway/contract/src/gateway.trpc.ts"}}
	parity := DiffProcedures(main, branch, namespaceOwner(map[string]string{"user": "user"}))
	if len(parity.OwnerMoves) != 0 {
		t.Fatalf("owner moves = %+v, want a changed field set to stay a gap", parity.OwnerMoves)
	}
	optional := objectInput(map[string]any{"organizationId": stringProperty()})
	branch[0].Input = organizationInput()
	main[0].Input = optional
	parity = DiffProcedures(main, branch, namespaceOwner(map[string]string{"user": "user"}))
	if len(parity.OwnerMoves) != 1 || len(parity.Breaking) != 1 || parity.Breaking[0].Path != "user.cliBootstrap" || parity.Breaking[0].Module != "gateway" {
		t.Fatalf("owner moves %+v breaking %+v, want the made-required field breaking", parity.OwnerMoves, parity.Breaking)
	}
}

func TestAnOwnerMoveNeedsTheSameKindAndOneCandidate(t *testing.T) {
	main := []Procedure{
		{Path: "user.budgetOverview", Kind: "query", Input: organizationInput(), Source: "main"},
		{Path: "user.cliBootstrap", Kind: "query", Input: organizationInput(), Source: "main"},
	}
	branch := []Procedure{
		{Path: "governance.budgetOverview", Kind: "mutation", Input: organizationInput(), Source: "enterprise/modules/governance/contract/src/governance.trpc.ts"},
		{Path: "governance.cliBootstrap", Kind: "query", Input: organizationInput(), Source: "enterprise/modules/governance/contract/src/governance.trpc.ts"},
		{Path: "gateway.cliBootstrap", Kind: "query", Input: organizationInput(), Source: "modules/gateway/contract/src/gateway.trpc.ts"},
	}
	parity := DiffProcedures(main, branch, namespaceOwner(map[string]string{"user": "user"}))
	if len(parity.OwnerMoves) != 0 || len(parity.Missing) != 2 {
		t.Fatalf("owner moves %+v missing %+v, want both left missing", parity.OwnerMoves, parity.Missing)
	}
}
