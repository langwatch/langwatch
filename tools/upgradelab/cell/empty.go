package cell

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// EmptyShape is a fresh install of the from release: no seed, no traffic (plan §7.1 `empty`, run R2-empty).
const EmptyShape = "empty"

func (cell *run) emptyOrigin() bool { return cell.options.Shape == EmptyShape }

// emptySteps is the empty cell: main makes its schema on blank stores, head boots on them and upgrades.
func (cell *run) emptySteps() []step {
	return []step{{"build", cell.buildBoth}, {"stores", cell.freshStores}, {"from-schema", cell.fromSchema}, {"from-up", cell.fromUp},
		{"observe", cell.observeOnly}, {"cut", cell.cut}, {"switch", cell.switchToHead}, {"ready", cell.awaitReady},
		{"settle", cell.settle}, {"checks", func(ctx context.Context) error {
			cell.stopObservers()
			return cell.emptyChecks(ctx)
		}}}
}

// observeOnly starts the samplers without traffic: an empty install has no project to send it to.
func (cell *run) observeOnly(ctx context.Context) error {
	samplerCtx, stopSampler := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopSampler = stopSampler
	go cell.sampleQueue(samplerCtx)
	cell.startObservers(ctx)
	cell.mark("trafficStart")
	return nil
}

// emptyAccount writes the seed account once head is ready, so the stores stay empty through the upgrade.
func (cell *run) emptyAccount(ctx context.Context) {
	if err := psqlFile(ctx, cell.stores.psqlURL(), generate.AccountSQL(cell.options.Seed)); err != nil {
		cell.report.Notes = append(cell.report.Notes, "seed account after ready: "+err.Error())
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	cell.seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: password, Label: cell.options.Name()})
}

func (cell *run) emptyChecks(ctx context.Context) error {
	cell.report.Marks, cell.report.Phases = cell.marks, cell.poller.Timeline()
	final, err := Ledger(ctx, cell.stores)
	if err != nil {
		return err
	}
	cell.report.Queue = cell.queueSummary(ctx)
	cell.report.Verdicts = append(cell.report.Verdicts,
		cell.holdingVerdict(), ledgerVerdict(final), notNeededVerdict(final), reopenedVerdict(cell.atReady, final), cell.rosterVerdict(ctx),
		cell.copyVerdict(ctx), cell.secondRunVerdict(ctx, final), cell.logVerdict(), cell.apiEarlyVerdict(), cell.crashVerdict(),
		cell.queueVerdict(), cell.opsVerdict(final), cell.storedEventsVerdict(ctx))
	for index := range cell.report.Verdicts {
		cell.report.Verdicts[index].Scenarios = scenarioIDs[cell.report.Verdicts[index].ID]
	}
	cell.report.Resources, _ = ResourcePeaks(filepath.Join(cell.options.RunDir, "resources.jsonl"))
	cell.report.Ribbon = Ribbon(cell.report, cell.origin, final)
	return nil
}

// notNeededVerdict (F1): on empty stores every step that is not schema or seed settles not-needed.
func notNeededVerdict(rows []LedgerRow) Verdict {
	var ran []string
	data := 0
	for _, row := range rows {
		if strings.HasSuffix(row.Kind, "-schema") || row.Kind == "seed" || row.Mode == "operator" {
			continue
		}
		data++
		if row.Status != "not-needed" {
			ran = append(ran, row.ID+"="+row.Status)
		}
	}
	return Verdict{ID: "F1", Name: "fresh install: every data step is not-needed", Result: map[bool]string{true: "pass", false: "fail"}[len(ran) == 0],
		Detail: fmt.Sprintf("%d data steps; not not-needed: %v", data, ran)}
}
