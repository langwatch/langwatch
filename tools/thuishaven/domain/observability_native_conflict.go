package domain

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// ObservabilityContainerRunning reads `docker inspect -f {{.State.Running}}`
// for haven's LGTM container: only a running one holds the public ports the
// native tier needs, so only a running one is stopped.
func ObservabilityContainerRunning(inspect string) bool {
	return strings.TrimSpace(inspect) == "true"
}

// NativeComponentPorts are the TCP ports a native component listens on, its
// public endpoints included, so a conflict names the one that is taken.
func NativeComponentPorts(p NativeObservabilityPlan, name string) []int {
	switch name {
	case "prometheus":
		return []int{p.Ports.PrometheusHTTP}
	case "loki":
		return []int{p.Ports.LokiHTTP, p.Ports.LokiGRPC}
	case "tempo":
		return []int{p.Ports.TempoHTTP, p.Ports.TempoGRPC, p.Ports.TempoOTLPHTTP}
	case "pyroscope":
		return []int{p.Endpoints.PyroscopePort, p.Ports.PyroscopeGRPC}
	case "alloy":
		return []int{p.Endpoints.OTLPGRPCPort, p.Endpoints.OTLPHTTPPort, p.Ports.CollectorHTTP}
	case "grafana":
		return []int{p.Endpoints.GrafanaPort}
	}
	return nil
}

// PortHolder is the process listening on a port.
type PortHolder struct {
	PID     int
	Command string
}

// ParseLsofListener reads `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc` output and
// returns the first process listed; false when nothing listens.
func ParseLsofListener(out string) (PortHolder, bool) {
	var h PortHolder
	for _, line := range strings.Split(out, "\n") {
		if len(line) < 2 {
			continue
		}
		if line[0] == 'p' && h.PID != 0 {
			return h, true
		}
		h.absorb(line)
	}
	return h, h.PID != 0
}

// absorb records one `p<pid>` or `c<command>` line; the first command wins.
func (h *PortHolder) absorb(line string) {
	switch line[0] {
	case 'p':
		h.PID, _ = strconv.Atoi(line[1:])
	case 'c':
		if h.Command == "" {
			h.Command = line[1:]
		}
	}
}

// PortConflictQuery is what PortConflict decides on.
type PortConflictQuery struct {
	Component string
	Binary    string
	Port      int
	Holder    PortHolder
	Held      bool
}

// PortConflict says why the component cannot serve on the port: "" when the
// port is free or held by the component's own binary (a run still starting
// up). lsof truncates command names, hence the prefix match.
func PortConflict(q PortConflictQuery) string {
	holder := q.Holder
	if !q.Held || (holder.Command != "" && strings.HasPrefix(filepath.Base(q.Binary), holder.Command)) {
		return ""
	}
	msg := fmt.Sprintf("%s: port %d is held by %s (pid %d)", q.Component, q.Port, holder.Command, holder.PID)
	if holder.Command == "ssh" || strings.HasPrefix(holder.Command, "limactl") {
		msg += ", a colima port forward: a container still publishes it"
	}
	return msg
}

// ParsePSRSS reads `ps -o rss= -p <pid>` (KiB) as bytes; false if unreadable.
func ParsePSRSS(out string) (int64, bool) {
	kib, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64)
	if err != nil || kib <= 0 {
		return 0, false
	}
	return kib << 10, true
}
