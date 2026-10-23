package backup

// Replicas is one server's view of its cluster: how many replicas it has,
// which position (0-based, in remote_servers order) is this server, and
// which positions answered a query just now.
type Replicas struct {
	Total     int
	Self      int
	Reachable []int
}

// Elect picks the runner: the preferred position if it answers, else the
// next one that does, wrapping. Every healthy server sees the same set and
// so picks the same runner; -1 when none answers.
func Elect(r Replicas, preferred int) int {
	if r.Total <= 0 {
		return -1
	}
	up := map[int]bool{}
	for _, p := range r.Reachable {
		up[p] = true
	}
	start := ((preferred % r.Total) + r.Total) % r.Total
	for i := 0; i < r.Total; i++ {
		if p := (start + i) % r.Total; up[p] {
			return p
		}
	}
	return -1
}

// IsRunner reports whether this server runs the backups. When its view of
// the cluster cannot be read, only the preferred position runs: a server
// that cannot see its peers must not assume they are down.
func IsRunner(r Replicas, preferred int, viewErr error) bool {
	if viewErr != nil {
		return r.Total > 0 && r.Self == ((preferred%r.Total)+r.Total)%r.Total
	}
	return Elect(r, preferred) == r.Self
}
