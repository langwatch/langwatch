package colima

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestNoRecordMeansNeverStopped(t *testing.T) {
	rt := New("default", domain.ColimaLimits{}, nil).WithHome(t.TempDir())
	stopped, err := rt.StopIfIdle(context.Background())
	if err != nil || stopped {
		t.Fatalf("StopIfIdle = %v, %v; a VM haven did not start must be left alone", stopped, err)
	}
	if rt.StoppedByHaven() {
		t.Fatal("StoppedByHaven without a record")
	}
}

func TestRecordedStartThenStopIsReported(t *testing.T) {
	rt := New("default", domain.ColimaLimits{}, nil).WithHome(t.TempDir())
	rt.recordStart()
	if rt.StoppedByHaven() {
		t.Fatal("a started VM is not stopped")
	}
	rec, ok := rt.readRecord()
	if !ok {
		t.Fatal("start was not recorded")
	}
	rec.StoppedAt = rec.StartedAt
	rt.writeRecord(rec)
	if !rt.StoppedByHaven() {
		t.Fatal("StoppedByHaven = false after a recorded stop")
	}
	rt.recordStart() // the next start clears the stopped mark
	if rt.StoppedByHaven() {
		t.Fatal("a new start must clear the stopped mark")
	}
}
