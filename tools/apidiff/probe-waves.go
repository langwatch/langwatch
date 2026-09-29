package apidiff

import (
	"net/http"
	"slices"

	"golang.org/x/sync/errgroup"
)

// opResult is what probing one operation produced, filed in probe order once
// its stage is over.
type opResult struct {
	findings    []Finding
	transcripts []Transcript
	probed      bool
}

// The main pass's stages, in the order they run (README "Probe order").
const (
	stageCurated = iota // the curated creates: one lane, in their own order
	stageIDFree         // what needs no captured id: every cross-module producer
	stageIDs            // what reads an id something before it captured
	stageDeletes        // after the lists are verified
	stageCount
)

// mainPass probes the selected operations stage by stage, verifying the lists
// before the first delete. It answers the findings in probe order, the number
// probed and whether the lists were verified.
func (engine *probeEngine) mainPass(selected []Operation) ([]Finding, int, bool) {
	stages := probeStages(selected, engine.options.ModuleOf)
	results := make([]opResult, len(selected))
	for _, lanes := range stages[:stageDeletes] {
		engine.runStage(selected, lanes, results)
	}
	findings, probed := engine.fileResults(selected, results, stages[:stageDeletes]...)
	if len(stages[stageDeletes]) == 0 {
		return findings, probed, false
	}
	// Deletes remove what the creates made, so the lists are read for the
	// created entities before the first delete, not after.
	findings = append(findings, engine.verifyCollections(selected)...)
	findings = append(findings, engine.roundTripPass(selected)...)
	engine.runStage(selected, stages[stageDeletes], results)
	deleted, probedDeletes := engine.fileResults(selected, results, stages[stageDeletes])
	return append(findings, deleted...), probed + probedDeletes, true
}

// probeStages splits the probe order into stages, and each stage into one
// lane per module, in order of first appearance; a lane keeps probe order.
func probeStages(selected []Operation, moduleOf func(method, path string) string) [stageCount][][]int {
	var stages [stageCount][][]int
	var laneOf [stageCount]map[string]int
	for index := range selected {
		operation := &selected[index]
		stage, module := stageOf(operation), ""
		if moduleOf != nil && stage != stageCurated {
			module = moduleOf(operation.Method, operation.Path)
		}
		if laneOf[stage] == nil {
			laneOf[stage] = map[string]int{}
		}
		lane, ok := laneOf[stage][module]
		if !ok {
			lane = len(stages[stage])
			laneOf[stage][module] = lane
			stages[stage] = append(stages[stage], nil)
		}
		stages[stage][lane] = append(stages[stage][lane], index)
	}
	return stages
}

func stageOf(operation *Operation) int {
	_, curated := curatedIndex[operationKeyOf(*operation)]
	switch {
	case curated:
		return stageCurated
	case operation.Method == http.MethodDelete:
		return stageDeletes
	case len(neededBuckets(operation)) == 0:
		return stageIDFree
	}
	return stageIDs
}

// runStage runs one stage's lanes, up to Concurrency at once. Several lanes
// each resolve and capture against their own copy of the symbol tables, and
// their captures are filed into the shared ones in probe order afterwards, so
// no lane's ids depend on how fast another ran.
func (engine *probeEngine) runStage(selected []Operation, lanes [][]int, results []opResult) {
	if len(lanes) > 1 {
		engine.lanes = laneTables(selected, lanes, engine.symbolsA, engine.symbolsB)
	}
	var group errgroup.Group
	group.SetLimit(max(engine.options.Concurrency, 1))
	for _, lane := range lanes {
		group.Go(func() error {
			for _, index := range lane {
				results[index] = engine.probeAt(selected, index)
			}
			return nil
		})
	}
	_ = group.Wait()
	if engine.lanes == nil {
		return
	}
	engine.lanes = nil
	for _, index := range inProbeOrder(lanes) {
		for _, transcript := range results[index].transcripts {
			captureSucceeded(engine.symbolsA, selected[index].Path, transcript.A)
			captureSucceeded(engine.symbolsB, selected[index].Path, transcript.B)
		}
	}
}

// laneTables gives each lane its own copy of both sides' tables, keyed by
// the operations it runs.
func laneTables(selected []Operation, lanes [][]int, symbolsA, symbolsB *SymbolTable) map[string][2]*SymbolTable {
	tables := map[string][2]*SymbolTable{}
	for _, lane := range lanes {
		own := [2]*SymbolTable{symbolsA.clone(), symbolsB.clone()}
		for _, index := range lane {
			tables[operationKeyOf(selected[index])] = own
		}
	}
	return tables
}

// symbolsFor is the tables an operation resolves and captures against: its
// lane's own during a stage of several lanes, else the shared ones.
func (engine *probeEngine) symbolsFor(operation Operation) (*SymbolTable, *SymbolTable) {
	if own, ok := engine.lanes[operationKeyOf(operation)]; ok {
		return own[0], own[1]
	}
	return engine.symbolsA, engine.symbolsB
}

// probeAt probes one operation of the probe order, unless it is left out.
func (engine *probeEngine) probeAt(selected []Operation, index int) opResult {
	operation := selected[index]
	if skip := notProbed(operation, engine.options.ExcludePrefixes); skip != "" {
		engine.progress("skip %s %s (%s) [%d/%d]\n", operation.Method, operation.Path, skip, index+1, len(selected))
		return opResult{}
	}
	engine.awaitFixtureTraceFor(operation)
	engine.progress("probe %s %s [%d/%d]\n", operation.Method, operation.Path, index+1, len(selected))
	result := engine.probeOperation(operation)
	result.probed = true
	if engine.options.OnOperationDone != nil {
		engine.mu.Lock()
		defer engine.mu.Unlock()
		engine.options.OnOperationDone(operation, result.findings)
	}
	return result
}

// fileResults files the stages' results in probe order: each operation's
// transcripts, the ids its owner read and its creates, then its findings.
func (engine *probeEngine) fileResults(selected []Operation, results []opResult, stages ...[][]int) ([]Finding, int) {
	findings, probed := make([]Finding, 0), 0
	for _, index := range inProbeOrder(slices.Concat(stages...)) {
		result := results[index]
		for _, transcript := range result.transcripts {
			engine.recordOwnerIDs(selected[index], transcript)
			engine.captureMutation(selected[index], transcript)
		}
		engine.transcripts = append(engine.transcripts, result.transcripts...)
		findings = append(findings, result.findings...)
		if result.probed {
			probed++
		}
	}
	return findings, probed
}

// inProbeOrder is every index the lanes hold, in probe order.
func inProbeOrder(lanes [][]int) []int {
	indices := slices.Concat(lanes...)
	slices.Sort(indices)
	return indices
}
