package interactionsimulator_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/visualdiff"
)

// TestEmittedFlowsLoadInVisualdiff loads the file src/__tests__/flows.unit.test.ts
// pins the simulator's emission to, through visualdiff's own LoadConfig.
func TestEmittedFlowsLoadInVisualdiff(t *testing.T) {
	emitted, err := os.ReadFile(filepath.Join("testdata", "flows", "simulated.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, visualdiff.FlowsDir), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, visualdiff.FlowsDir, "dataset.yaml"), emitted, 0o600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(dir, "visualdiff.yaml")
	if err := os.WriteFile(config, []byte("viewport: 1440x900\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := visualdiff.LoadConfig(config)
	if err != nil {
		t.Fatalf("visualdiff refused the emitted flows: %v", err)
	}
	if len(loaded.Flows) != 1 || loaded.Flows[0].ID != "sim-dataset-create" {
		t.Fatalf("loaded %+v, want the one flow sim-dataset-create", loaded.Flows)
	}
}
