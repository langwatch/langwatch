package domain

import (
	"strings"
	"testing"
)

func TestRefuseVMOnlyWhileOffAndNamesTheSetting(t *testing.T) {
	if err := (MachineSettings{}).RefuseVM("sandboxed Langy"); err != nil {
		t.Errorf("vm on refused: %v", err)
	}
	err := MachineSettings{VMOff: true}.RefuseVM("haven pr --throwaway")
	if err == nil || !strings.HasPrefix(err.Error(), "haven pr --throwaway needs the Colima VM") ||
		!strings.Contains(err.Error(), "haven machine settings set vm on") {
		t.Errorf("refusal = %v", err)
	}
	if err := (MachineSettings{VMOff: true}).RefuseVM(""); err == nil || !strings.Contains(err.Error(), "will not start the Colima VM") {
		t.Errorf("generic refusal = %v", err)
	}
}

// @scenario "With the VM off, ClickHouse and observability run natively"
func TestVMSettingChoosesEachRuntime(t *testing.T) {
	on, off := MachineSettings{}, MachineSettings{VMOff: true}
	cases := []struct {
		name     string
		settings MachineSettings
		stated   string
		want     ClickHouseRuntime
	}{
		{"vm on, default", on, "", ClickHouseRuntimeNative},
		{"vm on, container pinned", on, "container", ClickHouseRuntimeContainer},
		{"vm off, default", off, "", ClickHouseRuntimeNative},
		{"vm off overrides a container pin", off, "container", ClickHouseRuntimeNative},
	}
	for _, c := range cases {
		got, err := c.settings.ClickHouseRuntimeFor(c.stated, "darwin", "arm64")
		if err != nil || got != c.want {
			t.Errorf("%s: ClickHouse = %s, %v; want %s", c.name, got, err, c.want)
		}
	}
	if tier, _ := on.ObservabilityTierFor("linux", ""); tier != ObservabilityTierContainer {
		t.Errorf("vm on, linux: observability %s", tier)
	}
	if tier, _ := on.ObservabilityTierFor("darwin", "container"); tier != ObservabilityTierContainer {
		t.Errorf("vm on, container pin: observability %s", tier)
	}
	for _, pin := range []string{"", "container"} {
		if tier, _ := off.ObservabilityTierFor("linux", pin); tier != ObservabilityTierNative {
			t.Errorf("vm off, pin %q: observability %s, want native", pin, tier)
		}
	}
}

// @scenario "With the VM off, a machine with no native ClickHouse is told what to install"
func TestVMOffWithoutANativeClickHouseSaysWhatToInstall(t *testing.T) {
	_, err := MachineSettings{VMOff: true}.ClickHouseRuntimeFor("", "linux", "amd64")
	if err == nil || !strings.Contains(err.Error(), "install ClickHouse") || !strings.Contains(err.Error(), "LANGWATCH_HAVEN_CH=0") {
		t.Errorf("err = %v, want the install line", err)
	}
	if got, err := (MachineSettings{}).ClickHouseRuntimeFor("", "linux", "amd64"); err != nil || got != ClickHouseRuntimeContainer {
		t.Errorf("vm on, linux: %s %v", got, err)
	}
}
