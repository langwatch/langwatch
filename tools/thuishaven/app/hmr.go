package app

import (
	"context"
	"fmt"
	"time"
)

// defaultHMRGate is how long an agent-editing gate lasts if no TTL is given. It is
// deliberately short: the gate is a safety window for a burst of edits, not a
// long-lived block. It always expires on its own so HMR can never be stuck off.
const defaultHMRGate = 30 * time.Second

// RunHMR drives `haven hmr <on|off|status>`: the AI-gated HMR control. `on` writes
// a time-bounded marker that the Vite plugin reads to defer HMR while an agent
// edits; `off` clears it (HMR resumes + the browser catches up on the next
// reload); `status` reports the remaining gate.
func (o *Orchestrator) RunHMR(ctx context.Context, lwDir string, args []string) error {
	sub := "status"
	rest := args
	if len(args) > 0 {
		sub, rest = args[0], args[1:]
	}
	switch sub {
	case "on", "pause":
		ttl := defaultHMRGate
		for i := 0; i < len(rest)-1; i++ {
			if rest[i] == "--ttl" {
				if d, err := time.ParseDuration(rest[i+1]); err == nil {
					ttl = d
				}
			}
		}
		expiry := o.sys.Now().Add(ttl).UnixMilli()
		if err := o.store.WriteHMRGate(lwDir, expiry); err != nil {
			return err
		}
		fmt.Printf("HMR gated for %s — agent edits won't reload open browsers until then\n", ttl)
		return nil
	case "off", "resume":
		o.store.ClearHMRGate(lwDir)
		fmt.Println("HMR gate cleared — reloads resume")
		return nil
	case "status":
		exp, ok := o.store.ReadHMRGate(lwDir)
		if !ok {
			fmt.Println("HMR gate: off")
			return nil
		}
		remaining := time.UnixMilli(exp).Sub(o.sys.Now())
		if remaining <= 0 {
			fmt.Println("HMR gate: expired (off)")
			return nil
		}
		fmt.Printf("HMR gate: on, %s remaining\n", remaining.Round(time.Second))
		return nil
	default:
		return fmt.Errorf("unknown `haven hmr` subcommand %q (want on|off|status)", sub)
	}
}
