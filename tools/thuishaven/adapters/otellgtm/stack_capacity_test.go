package otellgtm

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// A colima VM created on a smaller machine (or sized by hand) is never
// resized by a later `colima start` on a bigger one — see colima.Runtime.Ensure
// — so DefaultObservabilityLimits, which is derived from the HOST's RAM/CPU,
// can ask for more than the VM the container actually runs in was given.
// Docker's own refusal for that is a hard "range of CPUs is from 0.01 to
// N.NN, as there are only N CPUs available", not a silent downscale.
//
// @scenario "The observability stack fits inside an undersized colima VM"
func TestClampLimitsToCapacityShrinksCPUsToWhatTheVMHas(t *testing.T) {
	l := domain.ObservabilityLimits{CPUs: 3, MemoryMB: 4096}

	got := clampLimitsToCapacity(l, 2, 8192)

	if got.CPUs != 2 {
		t.Fatalf("CPUs = %v, want 2 (the VM's own ceiling)", got.CPUs)
	}
}

// @scenario "The observability stack fits inside an undersized colima VM"
func TestClampLimitsToCapacityShrinksMemoryToWhatTheVMHas(t *testing.T) {
	l := domain.ObservabilityLimits{CPUs: 1, MemoryMB: 4096}

	got := clampLimitsToCapacity(l, 4, 2048)

	if got.MemoryMB != 2048 {
		t.Fatalf("MemoryMB = %v, want 2048 (the VM's own ceiling)", got.MemoryMB)
	}
}

// @scenario "The observability stack fits inside an undersized colima VM"
func TestClampLimitsToCapacityLeavesRoomWhenTheVMIsBigEnough(t *testing.T) {
	l := domain.ObservabilityLimits{CPUs: 2, MemoryMB: 2048}

	got := clampLimitsToCapacity(l, 8, 16384)

	if got.CPUs != 2 || got.MemoryMB != 2048 {
		t.Fatalf("got = %+v, want the configured limits untouched", got)
	}
}

// A zero or negative reading (colima status omitted or zeroed the field) is
// "unknown", not "the VM has nothing" — clamping to zero would make every run
// fail instead of the rare one that actually doesn't fit.
//
// @scenario "The observability stack fits inside an undersized colima VM"
func TestClampLimitsToCapacityIgnoresAnUnknownReading(t *testing.T) {
	l := domain.ObservabilityLimits{CPUs: 3, MemoryMB: 4096}

	got := clampLimitsToCapacity(l, 0, 0)

	if got != l {
		t.Fatalf("got = %+v, want the configured limits untouched when capacity is unknown", got)
	}
}

// The whole reason this exists: `(*exec.Cmd).Run` alone turns a one-line
// docker refusal into "exit status 125" and nothing else, because Cmd.Stderr
// defaults to nil and Run() wires a nil Stderr to the null device instead of
// capturing it.
//
// @scenario "haven surfaces docker's own error on a failed run"
func TestRunCapturingStderrFoldsDockersMessageIntoTheError(t *testing.T) {
	cmd := exec.CommandContext(context.Background(), "sh", "-c", "echo 'range of CPUs is from 0.01 to 2.00' >&2; exit 125")

	err := runCapturingStderr(cmd)

	if err == nil {
		t.Fatal("want an error from a command that exits 125")
	}
	if got := err.Error(); !strings.Contains(got, "range of CPUs is from 0.01 to 2.00") {
		t.Fatalf("error = %q, want it to contain docker's own stderr", got)
	}
}

// @scenario "haven surfaces docker's own error on a failed run"
func TestRunCapturingStderrIsSilentOnSuccess(t *testing.T) {
	cmd := exec.CommandContext(context.Background(), "sh", "-c", "exit 0")

	if err := runCapturingStderr(cmd); err != nil {
		t.Fatalf("want no error from a command that exits 0, got %v", err)
	}
}
