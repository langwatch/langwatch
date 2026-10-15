package domain

import (
	"strings"
	"testing"
	"time"
)

func TestMachineSettingsDefaults(t *testing.T) {
	var s MachineSettings
	if s.ObservabilityOff || s.VMOff || s.RuntimeAutoStop || s.RuntimeIdleGrace() != DefaultRuntimeIdleGrace {
		t.Errorf("zero settings = %+v, grace %s", s, s.RuntimeIdleGrace())
	}
}

func TestMachineSettingsWith(t *testing.T) {
	s, err := MachineSettings{}.With(SettingObservability, "off")
	if err != nil || !s.ObservabilityOff {
		t.Fatalf("observability off: %+v %v", s, err)
	}
	s, err = s.With(SettingVM, "off")
	if err != nil || !s.VMOff {
		t.Fatalf("vm off: %+v %v", s, err)
	}
	s, err = s.With(SettingRuntimeAutoStop, "ON")
	if err != nil || !s.RuntimeAutoStop {
		t.Fatalf("auto-stop on: %+v %v", s, err)
	}
	s, err = s.With(SettingRuntimeIdleGrace, "3")
	if err != nil || s.RuntimeIdleGrace() != 3*time.Minute {
		t.Fatalf("grace 3: %+v %v", s, err)
	}
	s, _ = s.With(SettingObservability, "")
	s, _ = s.With(SettingVM, "")
	s, _ = s.With(SettingRuntimeIdleGrace, "")
	if s.ObservabilityOff || s.VMOff || s.RuntimeIdleGraceMinutes != 0 {
		t.Errorf("empty values restore defaults: %+v", s)
	}
}

// @scenario "A setting names no known knob"
func TestMachineSettingsRefusesUnknownAndBadValues(t *testing.T) {
	if _, err := (MachineSettings{}).With("volume", "on"); err == nil || !strings.Contains(err.Error(), SettingObservability) {
		t.Errorf("unknown name: %v", err)
	}
	if _, err := (MachineSettings{}).With(SettingObservability, "maybe"); err == nil {
		t.Error("a switch accepted maybe")
	}
	for _, v := range []string{"0", "abc", "1441"} {
		if _, err := (MachineSettings{}).With(SettingRuntimeIdleGrace, v); err == nil {
			t.Errorf("grace accepted %q", v)
		}
	}
}

func TestMachineSettingsView(t *testing.T) {
	view := MachineSettings{ObservabilityOff: true}.View()
	if len(view) != 4 || view[0].Value != "off" || view[1].Value != "on" || view[2].Value != "off" || view[3].Value != "10" {
		t.Errorf("view = %+v", view)
	}
	if view[1].Name != SettingVM || view[1].Default != "on" || view[1].Kind != "switch" {
		t.Errorf("vm row = %+v", view[1])
	}
	if v := (MachineSettings{VMOff: true}).View()[1].Value; v != "off" {
		t.Errorf("vm off shows %q", v)
	}
}
