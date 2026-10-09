package domain

// ContainerNeedInputs are the selections that decide whether haven needs its
// container runtime (the colima VM) at all.
type ContainerNeedInputs struct {
	ClickHouse    ClickHouseRuntime // empty when haven does not manage ClickHouse
	Observability ObservabilityTier // empty when observability is off
	Stacks        []Stack
}

// ContainerNeeds names each selected container-only feature. None means the VM
// is not needed, so nothing may start it and status reports it without probing.
// haven play and isolated test runs start the VM themselves, on demand.
func ContainerNeeds(in ContainerNeedInputs) []string {
	var needs []string
	if in.ClickHouse == ClickHouseRuntimeContainer {
		needs = append(needs, "the ClickHouse container")
	}
	if in.Observability == ObservabilityTierContainer {
		needs = append(needs, "the LGTM container")
	}
	for i := range in.Stacks {
		if in.Stacks[i].LangyImage != "" {
			needs = append(needs, "sandboxed langy ("+in.Stacks[i].Slug+")")
		}
	}
	return needs
}
