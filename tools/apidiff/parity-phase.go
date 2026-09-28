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

	"golang.org/x/sync/errgroup"

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
	ServedOnly  *ServedParity  `json:"servedOnly,omitempty"`
	Modules     []ModuleCounts `json:"modules"`
	Notes       []string       `json:"notes,omitempty"`
}

// parityPhase is phase one of `apidiff run`: both trees prepared once, the
// way Boot then boots them, and both surfaces inventoried in the background
// while the instances migrate and seed.
type parityPhase struct {
	state  *bootState
	dir    string
	report ParityReport
	// modules memoizes the catalog lookups, which read the tree each call.
	modules map[string]string
	// inventoried closes once the background inventories have finished and
	// inventoryErr holds what they returned; cancelInventory stops them.
	inventoried     chan struct{}
	inventoryErr    error
	cancelInventory context.CancelFunc
}

// runParityPhase prepares both trees and starts the inventories in the
// background; finish waits for them. Unless the run stops after parity, the
// managed infrastructure starts at once and is up when the trees are ready.
func runParityPhase(ctx context.Context, boot BootConfig, stderr io.Writer) (*parityPhase, error) {
	state := &bootState{cfg: boot, stderr: &lockedWriter{out: stderr}, run: execRunner}
	phase := &parityPhase{state: state, modules: map[string]string{}}
	if err := phase.prepare(ctx, !boot.ParityOnly); err != nil {
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
		MainRef:     boot.MainRef, MainDir: state.mainDir, BranchDir: state.branchTree(),
	}
	inventoryCtx, cancel := context.WithCancel(ctx)
	phase.cancelInventory = cancel
	phase.inventoried = make(chan struct{})
	go func() {
		defer close(phase.inventoried)
		phase.inventoryErr = phase.inventory(inventoryCtx)
	}()
	return phase, nil
}

// prepare lays out the run, checks out main (and, on the haven path, the
// branch's own HEAD) and prepares both trees at once.
func (phase *parityPhase) prepare(ctx context.Context, bootsAfter bool) error {
	state := phase.state
	if err := state.prepareLayout(); err != nil {
		return err
	}
	if err := state.setupWorktree(ctx); err != nil {
		return err
	}
	state.timing("worktrees ready")
	if bootsAfter && !state.cfg.UseHaven {
		if err := state.startInfraEarly(ctx); err != nil {
			return err
		}
	}
	return state.prepareTrees(ctx)
}

// finish waits for the background inventories and answers their error.
func (phase *parityPhase) finish() error {
	<-phase.inventoried
	return phase.inventoryErr
}

// boot brings both instances up on the trees this phase prepared, sharing its
// state: one layout, one infrastructure, one teardown.
func (phase *parityPhase) boot(ctx context.Context) (*Booted, error) {
	return phase.state.boot(ctx)
}

// cleanup stops the inventories and tears the run down unless -keep asked
// for it to stay; the booted instances' teardown is this same call.
func (phase *parityPhase) cleanup() {
	if phase.inventoried != nil {
		phase.cancelInventory()
		<-phase.inventoried
	}
	phase.state.teardown()
}

// sideInventory is what one side's inventories read.
type sideInventory struct {
	procedures ProcedureManifest
	routes     RouteManifest
}

// inventory reads both sides' tRPC procedures and served routes at once and
// writes parity.json and the packets.
func (phase *parityPhase) inventory(ctx context.Context) error {
	sides := phase.state.sides()
	read := make([]sideInventory, len(sides))
	group, groupCtx := errgroup.WithContext(ctx)
	for index, side := range sides {
		group.Go(func() (err error) {
			read[index], err = phase.inventorySide(groupCtx, side)
			return err
		})
	}
	if err := group.Wait(); err != nil {
		return err
	}
	branch, main := read[0], read[1]
	phase.noteFailures(main, branch, false)
	phase.report.Trpc = DiffProcedures(main.procedures.Procedures, branch.procedures.Procedures, phase.procedureModule)
	document := phase.readMainRest()
	phase.noteFailures(main, branch, true)
	comparison := ServedComparison{Documented: DocumentedRoutes(document), ModuleOf: phase.restModule}
	served := DiffServedRoutes(main.routes.Routes, branch.routes.Routes, comparison)
	phase.report.ServedOnly = &served
	if err := phase.write(); err != nil {
		return err
	}
	phase.state.timing("parity inventories written")
	return nil
}

// inventorySide reads one side's tRPC procedures, then its served routes.
func (phase *parityPhase) inventorySide(ctx context.Context, side runSide) (sideInventory, error) {
	log := phase.state.sideLog("parity " + side.name)
	phase.state.logf("parity: inventory %s tRPC procedures and served routes (%s)", side.name, side.dir)
	procedures, err := trpcInventory{run: phase.state.run, inherit: phase.state.environ(), log: log}.
		collect(ctx, side.dir, filepath.Join(phase.dir, "trpc-"+side.name+".json"))
	if err != nil {
		return sideInventory{}, err
	}
	routes, err := routeInventory{run: phase.state.run, inherit: phase.state.environ(), log: log}.
		collect(ctx, side.dir, filepath.Join(phase.dir, "routes-"+side.name+".json"))
	if err != nil {
		return sideInventory{}, err
	}
	return sideInventory{procedures: procedures, routes: routes}, nil
}

// noteFailures records every source a side could not read, main before
// branch: the contracts on the first call, the route sources on the second.
func (phase *parityPhase) noteFailures(main, branch sideInventory, routes bool) {
	names := []string{"main", "branch"}
	for index, read := range []*sideInventory{&main, &branch} {
		if routes {
			for _, failure := range read.routes.Failures {
				phase.report.Notes = append(phase.report.Notes, fmt.Sprintf("%s routes of %s not read: %s", names[index], failure.Source, failure.Error))
			}
			continue
		}
		for _, failure := range read.procedures.Failures {
			phase.report.Notes = append(phase.report.Notes, fmt.Sprintf("%s contract %s not imported: %s", names[index], failure.Source, failure.Error))
		}
	}
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
			if module := namespaceModule(phase.state.branchTree(), candidate); module != "" {
				return module
			}
		}
		return ""
	})
}

// namespaceModule is the module an exact catalog name gives a namespace
// candidate, else the one its declarations and heuristics give it.
func namespaceModule(repoRoot, candidate string) string {
	if candidate == "" {
		return ""
	}
	if module := ModuleNamed(repoRoot, candidate); module != "" {
		return module
	}
	return ModuleForNamespace(repoRoot, candidate)
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
	return phase.memo(method+" "+path, func() string { return ModuleFor(phase.state.branchTree(), method, path) })
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

// readMainRest records main's REST count from the artifact it serves and
// answers the document, nil when there is none. The branch generates its
// document from the mounted routes, so its side is only known once it is
// serving; the full run completes REST parity then.
func (phase *parityPhase) readMainRest() map[string]any {
	data, err := os.ReadFile(filepath.Join(phase.state.mainDir, mainOpenAPIDocument)) // #nosec G304 -- a file inside this run's own worktree
	if err != nil {
		phase.report.Notes = append(phase.report.Notes, "main REST document not found at "+mainOpenAPIDocument)
		return nil
	}
	document, err := decodeObject(data)
	if err != nil {
		phase.report.Notes = append(phase.report.Notes, "main REST document unreadable: "+err.Error())
		return nil
	}
	phase.report.Notes = append(phase.report.Notes, fmt.Sprintf(
		"REST: main serves %d operations; the branch document is generated from its mounted routes, so REST parity is completed once the branch serves (a full run)",
		countOperations(document)))
	return document
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
