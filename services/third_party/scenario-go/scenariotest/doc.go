// Package scenariotest runs scenarios as Go tests, the counterpart of the JS
// vitest integration and the Python pytest plugin.
//
// [Run] ties a run to its test: the chat log and the verdict go to the test
// log, a failed verdict fails the test with the judge's reasoning, and an
// error stops it. [Main] runs the test binary and prints a summary of every
// scenario it ran. All runs of one `go test` invocation share a batch run
// id, so LangWatch groups them (SCENARIO_BATCH_RUN_ID overrides it).
//
//	package myagent_test
//
//	import (
//		"os"
//		"testing"
//
//		scenario "github.com/langwatch/scenario/go"
//		"github.com/langwatch/scenario/go/scenariotest"
//	)
//
//	func TestMain(m *testing.M) { os.Exit(scenariotest.Main(m)) }
//
//	func TestRefund(t *testing.T) {
//		t.Parallel()
//		result := scenariotest.Run(t, scenario.ScenarioConfig{
//			Name:        "refund request",
//			Description: "The customer wants a refund for a late order.",
//			Agents:      []scenario.AgentAdapter{myAgent, userSim, judge},
//		})
//		t.Logf("took %s", result.TotalTime)
//	}
//
// [Run] returns the result for further checks; it has already failed the
// test when the verdict is negative. Use scenario.Run directly to handle the
// result yourself. [WriteRun] and [Reporter] are the building blocks, for a
// custom report.
package scenariotest
