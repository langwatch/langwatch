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

	// Install on BOTH IPv4 (iptables) AND IPv6 (ip6tables). opencode
	// binds 127.0.0.1 today, so IPv4-only would already block the
	// known exfil path — but a future opencode bump that flips to dual-
	// stack or `::1` would silently re-open the hole. ip6tables is the
	// belt-and-braces companion. Sergio's 2026-06-30 review round 3.
	for _, bin := range []string{"iptables", "ip6tables"} {
		if err := installLoopbackDrop(bin, ruleSpec, dport, log); err != nil {
			return err
		}
	}
	return nil
}

// installLoopbackDrop adds (idempotently) the OWNER-DROP rule on the OUTPUT
// chain of `bin` (either iptables or ip6tables). Factored out so the IPv4
// and IPv6 installs share one code path and one failure-handling shape.
func installLoopbackDrop(bin string, ruleSpec []string, dport string, log *zap.Logger) error {
	// `bin -C OUTPUT <rule>` exits 0 if the rule exists, non-zero otherwise.
	checkArgs := append([]string{"-C", "OUTPUT"}, ruleSpec...)
	if err := exec.Command(bin, checkArgs...).Run(); err == nil {
		log.Info("loopback lockdown rule already present",
			zap.String("bin", bin),
			zap.String("dport", dport),
		)
		return nil
	}

	// Insert at the top of OUTPUT so it short-circuits any later
	// permissive rule.
	insertArgs := append([]string{"-I", "OUTPUT", "1"}, ruleSpec...)
	out, err := exec.Command(bin, insertArgs...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s insert (uid != 0 drop lo:%s): %w: %s",
			bin, dport, err, strings.TrimSpace(string(out)))
	}
	log.Info("loopback lockdown rule installed",
		zap.String("bin", bin),
		zap.String("dport", dport),
		zap.String("rule", "OUTPUT -o lo -p tcp --dport "+dport+" -m owner ! --uid-owner 0 -j DROP"),
	)
	return nil
}
