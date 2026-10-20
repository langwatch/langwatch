package fileregistry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func (s *Store) machineSettingsPath() string { return filepath.Join(s.home, "machine-settings.json") }

func (s *Store) focusPath() string { return filepath.Join(s.home, "focus") }

// ReadFocus is the focused stack's slug; absent reads as none.
func (s *Store) ReadFocus() string {
	b, err := os.ReadFile(s.focusPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// WriteFocus replaces the focused slug atomically; "" clears it.
func (s *Store) WriteFocus(slug string) error {
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	return writeFileAtomic(s.focusPath(), []byte(slug+"\n"), 0o644)
}

// ReadMachineSettings loads the machine's settings. Absent or corrupt reads as
// the defaults: a choice nobody has made yet is not a failure.
func (s *Store) ReadMachineSettings() domain.MachineSettings {
	var settings domain.MachineSettings
	b, err := os.ReadFile(s.machineSettingsPath())
	if err != nil || json.Unmarshal(b, &settings) != nil {
		return domain.MachineSettings{}
	}
	return settings
}

// WriteMachineSettings replaces the record atomically.
func (s *Store) WriteMachineSettings(settings domain.MachineSettings) error {
	b, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	return writeFileAtomic(s.machineSettingsPath(), append(b, '\n'), 0o644)
}
