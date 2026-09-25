package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
	"github.com/langwatch/langwatch/tools/openapidiff"
)

// mainOpenAPIDocument is the artifact main's monolith serves verbatim at
// /api/openapi.json, so main's REST surface is readable without booting it.
const mainOpenAPIDocument = "platform/app/src/app/api/openapiLangWatch.json"

// ParityReport is parity.json: both surfaces, both sides, grouped by module.
type ParityReport struct {
	GeneratedAt string         `json:"generatedAt"`
	MainRef     string         `json:"mainRef"`
	MainDir     string         `json:"mainDir"`
	BranchDir   string         `json:"branchDir"`
	Trpc        TrpcParity     `json:"trpc"`
	Rest        *RestParity    `json:"rest,omitempty"`
	Modules     []ModuleCounts `json:"modules"`
	Notes       []string       `json:"notes,omitempty"`
}

// parityPhase is phase one of `apidiff run`: both worktrees prepared the way
// Boot prepares them, both tRPC surfaces inventoried, and the packets written,
// before any stack boots.
type parityPhase struct {
	state  *bootState
	dir    string
	report ParityReport
	// modules memoizes the catalog lookups, which read the tree each call.
	modules map[string]string
}

// runParityPhase prepares both worktrees and writes the tRPC parity. It never
// boots a stack; the caller decides whether a run continues past it.
func runParityPhase(ctx context.Context, boot BootConfig, stderr io.Writer) (*parityPhase, error) {
	cfg := boot
	cfg.UseHaven = true
	state := &bootState{cfg: cfg, stderr: stderr, run: execRunner}
	phase := &parityPhase{state: state, modules: map[string]string{}}
	if err := phase.prepare(ctx); err != nil {
		phase.cleanup()
		return nil, err
	}
	phase.dir = filepath.Join(state.workRoot, "parity")
	if err := os.MkdirAll(phase.dir, 0o750); err != nil {
		phase.cleanup()
		return nil, err
	}
	phase.report = ParityReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		MainRef:     boot.MainRef, MainDir: state.mainDir, BranchDir: state.branchDir,
	}
	if err := phase.inventoryTrpc(ctx); err != nil {
		phase.cleanup()
		return nil, err
	}
	phase.readMainRest()
	err := phase.write()
	return phase, err
}

func (phase *parityPhase) prepare(ctx context.Context) error {
	if err := phase.state.prepareLayout(); err != nil {
		return err
	}
	if err := phase.state.setupWorktree(ctx); err != nil {
		return err
	}
	for _, dir := range []string{phase.state.mainDir, phase.state.branchDir} {
		if err := phase.installForInventory(ctx, dir); err != nil {
			return err
		}
	}
	return nil
}

// installForInventory runs the shared prepare steps minus the workspace build:
// the inventories import TypeScript source, so a branch whose build is red
// still gets its parity. Boot runs the full list before any stack starts.
func (phase *parityPhase) installForInventory(ctx context.Context, dir string) error {
	for _, step := range havenrun.PrepareCommands(havenrun.LayoutMonolith) {
		argv := step.Name + " " + strings.Join(step.Args, " ")
		phase.state.logf("parity prepare %s: %s", dir, argv)
		if err := phase.state.run(ctx, commandSpec{name: step.Name, args: step.Args, dir: dir}, phase.state.stderr); err != nil {
			return fmt.Errorf("parity prepare %s (%s): %w", dir, argv, err)
		}
	}
	return nil
}

// cleanup removes the worktrees this phase added unless -keep asked for them.
func (phase *parityPhase) cleanup() {
	if phase.state.cfg.Keep {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	phase.state.removeOwnedWorktrees(ctx)
}

// continueInto hands the prepared worktrees to Boot, so the behavioral phase
// reuses them instead of checking both refs out a second time.
func (phase *parityPhase) continueInto(boot *BootConfig) {
	boot.WorkRoot = phase.state.workRoot
	boot.ReuseWorktrees = true
}

func (phase *parityPhase) inventoryTrpc(ctx context.Context) error {
	sides := map[string]string{"main": phase.state.mainDir, "branch": phase.state.branchDir}
	manifests := map[string]ProcedureManifest{}
	for _, side := range []string{"main", "branch"} {
		out := filepath.Join(phase.dir, "trpc-"+side+".json")
		phase.state.logf("parity: inventory %s tRPC procedures (%s)", side, sides[side])
		inventory := trpcInventory{run: phase.state.run, inherit: phase.state.environ(), log: phase.state.stderr}
		manifest, err := inventory.collect(ctx, sides[side], out)
		if err != nil {
			return err
		}
		for _, failure := range manifest.Failures {
			phase.report.Notes = append(phase.report.Notes, fmt.Sprintf("%s contract %s not imported: %s", side, failure.Source, failure.Error))
		}
		manifests[side] = manifest
	}
	phase.report.Trpc = DiffProcedures(manifests["main"].Procedures, manifests["branch"].Procedures, phase.procedureModule)
	return nil
}

// procedureModule names the owning module: the branch contract that declares
// the procedure, else the catalog module declaring its namespace.
func (phase *parityPhase) procedureModule(procedure Procedure) string {
	if module := contractModule(procedure.Source); module != "" {
		return module
	}
	namespace, _ := splitProcedurePath(procedure.Path)
	return phase.memo("trpc "+namespace, func() string {
		for _, candidate := range []string{namespace, leadingWord(namespace), enterpriseSegment(procedure.Source)} {
			if module := ModuleForNamespace(phase.state.branchDir, candidate); candidate != "" && module != "" {
				return module
			}
		}
		return ""
	})
}

// leadingWord is a camelCase namespace's first word: governanceCost is governance's.
func leadingWord(namespace string) string {
	for position, char := range namespace {
		if position > 0 && char >= 'A' && char <= 'Z' {
			return namespace[:position]
		}
	}
	return ""
}

// enterpriseSegment names the ee/<module>/ folder a main router lives in.
func enterpriseSegment(source string) string {
	_, rest, found := strings.Cut(source, "/ee/")
	if !found {
		return ""
	}
	segment, _, _ := strings.Cut(rest, "/")
	return segment
}

func (phase *parityPhase) restModule(method, path string) string {
	return phase.memo(method+" "+path, func() string { return ModuleFor(phase.state.branchDir, method, path) })
}

func (phase *parityPhase) memo(key string, lookup func() string) string {
	if module, ok := phase.modules[key]; ok {
		return module
	}
	module := lookup()
	if module == "" {
		module = unownedModule
	}
	phase.modules[key] = module
	return module
}

// contractModule reads the module out of a branch contract path
// (modules/<m>/contract/… or enterprise/modules/<m>/contract/…).
func contractModule(source string) string {
	parts := strings.Split(filepath.ToSlash(source), "/")
	for index := 0; index+2 < len(parts); index++ {
		if parts[index] == "modules" && parts[index+2] == "contract" {
			return parts[index+1]
		}
	}
	return ""
}

// readMainRest records main's REST count from the artifact it serves. The
// branch generates its document from the mounted routes, so its side is only
// known once it is serving; the full run completes REST parity then.
func (phase *parityPhase) readMainRest() {
	data, err := os.ReadFile(filepath.Join(phase.state.mainDir, mainOpenAPIDocument)) // #nosec G304 -- a file inside this run's own worktree
	if err != nil {
		phase.report.Notes = append(phase.report.Notes, "main REST document not found at "+mainOpenAPIDocument)
		return
	}
	document, err := decodeObject(data)
	if err != nil {
		phase.report.Notes = append(phase.report.Notes, "main REST document unreadable: "+err.Error())
		return
	}
	phase.report.Notes = append(phase.report.Notes, fmt.Sprintf(
		"REST: main serves %d operations; the branch document is generated from its mounted routes, so REST parity is completed once the branch serves (a full run)",
		countOperations(document)))
}

// completeWithRest adds REST parity from both served documents, rewrites the
// outputs, and returns the tRPC changes for the report and ledger.
func (phase *parityPhase) completeWithRest(base, candidate map[string]any) []openapidiff.Change {
	rest, err := DiffRest(base, candidate, phase.restModule)
	if err != nil {
		phase.state.logf("parity: REST: %v", err)
	} else {
		phase.report.Rest = &rest
	}
	if err := phase.write(); err != nil {
		phase.state.logf("parity: %v", err)
	}
	return phase.report.Trpc.TrpcChanges()
}

// write saves parity.json and one packet per module with work in it.
func (phase *parityPhase) write() error {
	phase.report.Modules = moduleCounts(phase.report)
	if err := writeJSONFile(filepath.Join(phase.state.workRoot, "parity.json"), func(file *os.File) error {
		encoder := json.NewEncoder(file)
		encoder.SetIndent("", "  ")
		return encoder.Encode(phase.report)
	}); err != nil {
		return err
	}
	for _, counts := range phase.report.Modules {
		packet := renderPacket(phase.report, counts.Module)
		path := filepath.Join(phase.dir, packetFileName(counts.Module))
		if err := os.WriteFile(path, []byte(packet), 0o600); err != nil {
			return err
		}
	}
	phase.state.logf("parity: %s and %d module packets in %s", filepath.Join(phase.state.workRoot, "parity.json"), len(phase.report.Modules), phase.dir)
	return nil
}

func packetFileName(module string) string {
	return strings.Trim(strings.NewReplacer("(", "", ")", "", "/", "-").Replace(module), "-") + ".md"
}

// verdict ends a -parity-only run: the table on stdout, and the tRPC causes
// through the same report, ledger and exit code a full run uses.
func (phase *parityPhase) verdict(probe *probeFlags, out streams) int {
	if err := WriteParityTable(out.stdout, phase.report); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	baseline, err := loadBaseline(probe.ledgerBaseline)
	if err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	verdict := runVerdict{report: BuildReport(phase.report.Trpc.TrpcChanges(), ProbeResult{}), probe: probe}
	verdict.ledger = BuildLedger(nil, verdict.report, baseline)
	if probe.ledgerFile == "" {
		probe.ledgerFile = filepath.Join(phase.state.workRoot, "ledger.json")
	}
	if err := verdict.writeFiles(out); err != nil {
		fmt.Fprintln(out.stderr, err)
		return exitError
	}
	return verdict.exitCode(out)
}
