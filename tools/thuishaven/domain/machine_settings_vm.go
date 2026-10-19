package domain

import "fmt"

// RefuseVM is the one line a feature that needs the Colima VM refuses with
// while the vm setting is off, and nil while it is on. An empty feature names
// the VM start itself.
func (s MachineSettings) RefuseVM(feature string) error {
	if !s.VMOff {
		return nil
	}
	allow := fmt.Sprintf("the machine setting %s is off (`haven machine settings set %s on` allows it)", SettingVM, SettingVM)
	if feature == "" {
		return fmt.Errorf("haven will not start the Colima VM: %s", allow)
	}
	return fmt.Errorf("%s needs the Colima VM, and %s", feature, allow)
}

// ClickHouseRuntimeFor is ResolveClickHouseRuntime under these settings: with
// the VM off the server is always native, whatever HAVEN_CH_RUNTIME says, and
// a machine with no pinned binary is told what to install instead.
func (s MachineSettings) ClickHouseRuntimeFor(stated, goos, goarch string) (ClickHouseRuntime, error) {
	if !s.VMOff {
		return ResolveClickHouseRuntime(stated, goos, goarch)
	}
	if _, pinned := ClickHouseNativeArtifactFor(goos, goarch); pinned {
		return ClickHouseRuntimeNative, nil
	}
	return ClickHouseRuntimeContainer, fmt.Errorf(
		"the machine setting %s is off and haven pins no native ClickHouse for %s/%s: install ClickHouse (https://clickhouse.com/docs/install), "+
			"point CLICKHOUSE_URL at it and set LANGWATCH_HAVEN_CH=0, or `haven machine settings set %s on`",
		SettingVM, goos, goarch, SettingVM)
}

// ObservabilityTierFor is the package's ObservabilityTierFor under these
// settings: with the VM off the stack always runs natively.
func (s MachineSettings) ObservabilityTierFor(goos, pinned string) (tier ObservabilityTier, ok bool) {
	tier, ok = ObservabilityTierFor(goos, pinned)
	if s.VMOff {
		return ObservabilityTierNative, ok
	}
	return tier, ok
}
