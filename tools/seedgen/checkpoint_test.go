package seedgen

import (
	"path/filepath"
	"testing"
)

func TestCheckpointAdvancesOverContiguousAcksAndResumes(t *testing.T) {
	checkpoint := NewCheckpoint("run1", Refs{"$org:private-1": "organization_fixed"})
	checkpoint.Ack(2, KindOrgCreate, map[string]string{"$org:startup-1": "org_1"})
	if checkpoint.Cursor != 0 || !checkpoint.Done(2) || checkpoint.Done(1) {
		t.Fatalf("out-of-order ack: cursor %d, acked %v", checkpoint.Cursor, checkpoint.Acked)
	}
	checkpoint.Ack(1, KindUserCreate, nil)
	checkpoint.Ack(1, KindUserCreate, nil)
	if checkpoint.Cursor != 2 || len(checkpoint.Acked) != 0 || checkpoint.Counters[KindUserCreate] != 1 {
		t.Fatalf("contiguous acks: cursor %d, acked %v, counters %v", checkpoint.Cursor, checkpoint.Acked, checkpoint.Counters)
	}

	path := filepath.Join(t.TempDir(), "seed", "run.json")
	if err := checkpoint.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadCheckpoint(path, "run1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Cursor != 2 || loaded.Refs["$org:startup-1"] != "org_1" || loaded.Refs["$org:private-1"] != "organization_fixed" {
		t.Errorf("loaded checkpoint: %+v", loaded)
	}
	if _, err := LoadCheckpoint(path, "run2"); err == nil {
		t.Error("a checkpoint from another run was accepted")
	}
}
