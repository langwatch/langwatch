package fileregistry

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestMachineSettingsRoundTripAcrossProcesses(t *testing.T) {
	home := t.TempDir()
	want := domain.MachineSettings{ObservabilityOff: true, RuntimeAutoStop: true, RuntimeIdleGraceMinutes: 5}
	if err := New(home).WriteMachineSettings(want); err != nil {
		t.Fatalf("WriteMachineSettings: %v", err)
	}
	if got := New(home).ReadMachineSettings(); got != want {
		t.Errorf("read %+v, want %+v", got, want)
	}
}

func TestMachineSettingsAbsentOrCorruptReadAsDefaults(t *testing.T) {
	home := t.TempDir()
	if got := New(home).ReadMachineSettings(); got != (domain.MachineSettings{}) {
		t.Errorf("absent = %+v", got)
	}
	if err := os.WriteFile(filepath.Join(home, "machine-settings.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := New(home).ReadMachineSettings(); got != (domain.MachineSettings{}) {
		t.Errorf("corrupt = %+v", got)
	}
}
