package langyagent

import (
	"fmt"
	"os/exec"
	"strings"

	"go.uber.org/zap"
)

// InternalPortRange is the iptables-locked-down TCP port range that worker
// opencode processes listen on (one port per worker; chosen via
// getFreePortInRange). The bearer-token authproxy listens on an ephemeral
// external port OUTSIDE this range. The lockdown rule says: only uid 0
// (the manager) may CONNECT to ports inside this range on the loopback
// interface. Combined with the per-worker UID + 0700 home, this closes
// the sibling-worker exfiltration path Sergio flagged on 2026-06-30:
// without the rule, a prompt-injected worker A could scan
// /proc/net/tcp, find sibling B's opencode internal port, and connect to
// it as B's UID — leaking B's env (LANGWATCH_API_KEY, GH_TOKEN, ...)
// from inside B's own process.
//
// Tunable but not normally overridden; pinning is what lets the
// iptables rule target a known range rather than the entire ephemeral
// port space.
const (
	InternalPortRangeMin = 40000
	InternalPortRangeMax = 49999
)

// LockdownLoopbackPortRange installs an iptables OUTPUT rule that drops
// loopback-TCP packets from any non-root UID to the internal opencode
// port range. Requires CAP_NET_ADMIN on the manager pod (added to the
// chart's containerSecurityContext.capabilities.add list).
//
// Idempotent: `-C` checks for an existing identical rule before `-I`
// inserts. Safe to call on every manager start, including replicas
// reusing the same netns (k8s pod re-creation).
//
// Failure handling: returns the iptables error verbatim so the caller
// can decide whether to abort startup (production: yes; dev: optionally
// downgrade to warn via LANGY_LOOPBACK_LOCKDOWN_DISABLED=true).
func LockdownLoopbackPortRange(minPort, maxPort int, log *zap.Logger) error {
	dport := fmt.Sprintf("%d:%d", minPort, maxPort)
	ruleSpec := []string{
		"-o", "lo",
		"-p", "tcp",
		"--dport", dport,
		"-m", "owner",
		"!", "--uid-owner", "0",
		"-j", "DROP",
	}

	// `iptables -C OUTPUT <rule>` exits 0 if the rule exists, non-zero
	// otherwise. We don't care about the error message; existence is the
	// only signal we need.
	checkArgs := append([]string{"-C", "OUTPUT"}, ruleSpec...)
	if err := exec.Command("iptables", checkArgs...).Run(); err == nil {
		log.Info("loopback lockdown rule already present",
			zap.Int("min", minPort),
			zap.Int("max", maxPort),
		)
		return nil
	}

	// Insert at the top of OUTPUT so it short-circuits any later
	// permissive rule. `-I OUTPUT 1` is the canonical "first slot"
	// position; subsequent rules from other tooling won't outrank us.
	insertArgs := append([]string{"-I", "OUTPUT", "1"}, ruleSpec...)
	out, err := exec.Command("iptables", insertArgs...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("iptables insert (uid != 0 drop lo:%s): %w: %s",
			dport, err, strings.TrimSpace(string(out)))
	}
	log.Info("loopback lockdown rule installed",
		zap.Int("min", minPort),
		zap.Int("max", maxPort),
		zap.String("rule", "OUTPUT -o lo -p tcp --dport "+dport+" -m owner ! --uid-owner 0 -j DROP"),
	)
	return nil
}
