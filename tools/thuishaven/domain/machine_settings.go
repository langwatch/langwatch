package domain

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// MachineSettings are the choices that hold for every stack on this machine,
// saved in haven's home and edited by `haven machine settings` and the hub.
// The zero value is the default: observability on, the VM allowed and left alone.
type MachineSettings struct {
	ObservabilityOff        bool `json:"observabilityOff,omitempty"`
	VMOff                   bool `json:"vmOff,omitempty"`
	RuntimeAutoStop         bool `json:"runtimeAutoStop,omitempty"`
	RuntimeIdleGraceMinutes int  `json:"runtimeIdleGraceMinutes,omitempty"`
}

// The kebab names the CLI and the hub address each setting by.
const (
	SettingObservability    = "observability"
	SettingVM               = "vm"
	SettingRuntimeAutoStop  = "runtime-auto-stop"
	SettingRuntimeIdleGrace = "runtime-idle-grace-minutes"
)

// DefaultRuntimeIdleGrace is how long the VM must sit unused before auto-stop.
const DefaultRuntimeIdleGrace = 10 * time.Minute

// maxRuntimeIdleGraceMinutes bounds the grace at a day.
const maxRuntimeIdleGraceMinutes = 24 * 60

// RuntimeIdleGrace is the effective grace period.
func (s MachineSettings) RuntimeIdleGrace() time.Duration {
	if s.RuntimeIdleGraceMinutes <= 0 {
		return DefaultRuntimeIdleGrace
	}
	return time.Duration(s.RuntimeIdleGraceMinutes) * time.Minute
}

// MachineSettingView is one setting as the CLI prints it and the hub shows it.
type MachineSettingView struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"` // "switch" (on|off) or "minutes"
	Value   string `json:"value"`
	Default string `json:"default"`
	Summary string `json:"summary"`
}

// View lists every setting, in the order the CLI prints them.
func (s MachineSettings) View() []MachineSettingView {
	return []MachineSettingView{
		{Name: SettingObservability, Kind: "switch", Value: onOff(!s.ObservabilityOff), Default: "on",
			Summary: "run the shared observability stack (Grafana, Tempo, Loki, Prometheus, Pyroscope); off stops it and stacks export nothing"},
		{Name: SettingVM, Kind: "switch", Value: onOff(!s.VMOff), Default: "on",
			Summary: "off: never start the Colima VM; ClickHouse and observability run natively, and features that need a container refuse"},
		{Name: SettingRuntimeAutoStop, Kind: "switch", Value: onOff(s.RuntimeAutoStop), Default: "off",
			Summary: "stop the colima VM, whoever started it, once no stack needs it and no container runs on it for the grace period"},
		{Name: SettingRuntimeIdleGrace, Kind: "minutes", Value: strconv.Itoa(int(s.RuntimeIdleGrace() / time.Minute)),
			Default: strconv.Itoa(int(DefaultRuntimeIdleGrace / time.Minute)),
			Summary: "how long the VM must sit unused before auto-stop stops it"},
	}
}

// With answers the settings with name set to value; an empty value restores the default.
func (s MachineSettings) With(name, value string) (MachineSettings, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	switch name {
	case SettingObservability:
		on, err := parseSwitch(name, value, true)
		s.ObservabilityOff = !on
		return s, err
	case SettingVM:
		on, err := parseSwitch(name, value, true)
		s.VMOff = !on
		return s, err
	case SettingRuntimeAutoStop:
		on, err := parseSwitch(name, value, false)
		s.RuntimeAutoStop = on
		return s, err
	case SettingRuntimeIdleGrace:
		if value == "" {
			s.RuntimeIdleGraceMinutes = 0
			return s, nil
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > maxRuntimeIdleGraceMinutes {
			return s, fmt.Errorf("%s takes whole minutes from 1 to %d, not %q", name, maxRuntimeIdleGraceMinutes, value)
		}
		s.RuntimeIdleGraceMinutes = n
		return s, nil
	}
	return s, fmt.Errorf("no machine setting %q — the settings are %s, %s, %s and %s",
		name, SettingObservability, SettingVM, SettingRuntimeAutoStop, SettingRuntimeIdleGrace)
}

func parseSwitch(name, value string, def bool) (bool, error) {
	switch value {
	case "":
		return def, nil
	case "on", "true", "1", "yes":
		return true, nil
	case "off", "false", "0", "no":
		return false, nil
	}
	return def, fmt.Errorf("%s is on or off, not %q", name, value)
}

func onOff(on bool) string {
	if on {
		return "on"
	}
	return "off"
}
