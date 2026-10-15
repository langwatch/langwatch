package domain

import (
	"slices"
	"testing"
)

// @scenario "A default Mac needs no colima VM"
func TestDefaultMacNeedsNoContainerRuntime(t *testing.T) {
	needs := ContainerNeeds(ContainerNeedInputs{
		ClickHouse:    ClickHouseRuntimeNative,
		Observability: ObservabilityTierNative,
		Stacks:        []Stack{{Slug: "host-langy"}},
	})
	if len(needs) != 0 {
		t.Errorf("needs = %v, want none", needs)
	}
}

// @scenario "Each container-only selection names why the VM is needed"
func TestEachContainerOnlySelectionNamesItsNeed(t *testing.T) {
	needs := ContainerNeeds(ContainerNeedInputs{
		ClickHouse:    ClickHouseRuntimeContainer,
		Observability: ObservabilityTierContainer,
		Stacks:        []Stack{{Slug: "a"}, {Slug: "b", LangyImage: "langy:abc"}},
	})
	want := []string{"the ClickHouse container", "the LGTM container", "sandboxed langy (b)"}
	if !slices.Equal(needs, want) {
		t.Errorf("needs = %v, want %v", needs, want)
	}
}
