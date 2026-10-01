//go:build dev

package main

import (
	"context"

	analyticssim "github.com/langwatch/langwatch/services/analyticssim/cmd"
	idpsim "github.com/langwatch/langwatch/services/idpsim/cmd"
	llmsim "github.com/langwatch/langwatch/services/llmsim/cmd"
	mailsim "github.com/langwatch/langwatch/services/mailsim/cmd"
	storagesim "github.com/langwatch/langwatch/services/storagesim/cmd"
	voicesim "github.com/langwatch/langwatch/services/voicesim/cmd"
)

// combinedIDPAddrEnv is idpsim's port in the combined process (SERVER_ADDR alone).
const combinedIDPAddrEnv = "LANGWATCH_GO_IDPSIM_ADDR"

// simulator is one development simulator: its place in `service combined` and
// its standalone subcommand.
type simulator struct {
	combinedService
	Root ServiceBoot
}

// simulators exist only in a dev build (`-tags dev`: make service, the Nx
// `service` target), where `service combined` hosts them beside the data plane
// and each is still its own subcommand. Release images build untagged, so no
// simulator is linked or selectable there. A new simulator is one entry here.
var simulators = []simulator{
	{combinedService{
		Name: "idpsim", Telemetry: "langwatch-service-idpsim", AddrEnv: combinedIDPAddrEnv,
		Run: func(ctx context.Context, addr string) error {
			return idpsim.Run(ctx, idpsim.Options{Addr: addr})
		},
	}, idpsim.Root},
	// The rest already read an address variable of their own, never SERVER_ADDR.
	ownAddr("mailsim", "MAILSIM_HTTP_ADDR", mailsim.Root),
	ownAddr("storagesim", "STORAGESIM_ADDR", storagesim.Root),
	ownAddr("voicesim", "VOICESIM_ADDR", voicesim.Root),
	ownAddr("llmsim", "LLMSIM_ADDR", llmsim.Root),
	ownAddr("analyticssim", "ANALYTICSSIM_ADDR", analyticssim.Root),
}

// ownAddr is a simulator whose own configuration reads addrEnv, so the combined
// process runs its standalone entry point unchanged.
func ownAddr(name, addrEnv string, root ServiceBoot) simulator {
	return simulator{combinedService{
		Name: name, Telemetry: "langwatch-service-" + name, AddrEnv: addrEnv,
		Run: func(ctx context.Context, _ string) error { return root(ctx, nil) },
	}, root}
}

func init() {
	for _, sim := range simulators {
		services[sim.Name] = sim.Root
		combinedServices = append(combinedServices, sim.combinedService)
	}
}
