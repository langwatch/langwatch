package domain

import "strings"

// RushGateHeldEnv is set by rush's gate on a run it admitted.
const RushGateHeldEnv = "RUSH_GATE_HELD"

// rushGatePreload is the tail of the Node preload rush's gate puts on NODE_OPTIONS.
const rushGatePreload = "/gate/node/preload.cjs"

// UnderRushGate is whether the caller already runs under rush's gate, so a
// haven slot on top would only hold haven's slot while rush queues the run.
func UnderRushGate(getenv func(string) string) bool {
	return getenv(RushGateHeldEnv) != "" || strings.Contains(getenv("NODE_OPTIONS"), rushGatePreload)
}
