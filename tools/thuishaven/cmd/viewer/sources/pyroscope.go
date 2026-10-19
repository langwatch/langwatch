package sources

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"time"
)

// Pyroscope is the profiles tab's backing. Traces say which call was slow and
// metrics say the process was busy; neither says which function burned the CPU,
// which is the question this tab exists to answer without leaving the terminal.

// topFunctions is how many functions each list shows.
const topFunctions = 10

// profileQueries are the two questions asked per service. The two runtimes
// report different profile types - the Go services sample CPU, the Node
// applications sample wall time - so each service is asked for the pair its own
// runtime actually pushes, and a service asked for the other one looks empty
// rather than missing.
type profileQueries struct {
	cpu  string
	heap string
}

// goProfiles and nodeProfiles are the two runtimes' spellings.
var (
	goProfiles   = profileQueries{cpu: "process_cpu:cpu:nanoseconds:cpu:nanoseconds", heap: "memory:inuse_space:bytes:space:bytes"}
	nodeProfiles = profileQueries{cpu: "wall:wall:nanoseconds:wall:nanoseconds", heap: "memory:inuse_space:bytes:space:bytes"}
)

// Pyroscope reads the bundle's Pyroscope over its own published port.
type Pyroscope struct {
	api      endpoint
	grafana  string
	worktree string
	// services is what to ask about, and which runtime each one is.
	services []ProfiledService
}

// ProfiledService names one service to profile and the runtime it runs on.
type ProfiledService struct {
	// Name is the service's OpenTelemetry service name, which is also its
	// Pyroscope application name.
	Name string
	// Go marks a Go service, which pushes CPU where a Node one pushes wall time.
	Go bool
}

// PyroscopeConfig is where the profile source reads from and what it asks about.
type PyroscopeConfig struct {
	PyroscopePort int
	GrafanaPort   int
	Worktree      string
	Services      []ProfiledService
}

// NewPyroscope opens a source over the bundle's Pyroscope for one worktree.
func NewPyroscope(cfg PyroscopeConfig) *Pyroscope {
	return &Pyroscope{
		api:      newEndpoint(cfg.PyroscopePort),
		grafana:  fmt.Sprintf("http://127.0.0.1:%d", cfg.GrafanaPort),
		worktree: cfg.Worktree,
		services: cfg.Services,
	}
}

// Up reports whether the observability stack is listening.
func (p *Pyroscope) Up() bool { return p.api.up() }

// Top returns each service's hottest functions by CPU and by heap.
func (p *Pyroscope) Top() ([]ServiceProfile, error) {
	if !p.Up() {
		return nil, ErrStackDown
	}
	out := make([]ServiceProfile, 0, len(p.services))
	for _, svc := range p.services {
		queries := nodeProfiles
		if svc.Go {
			queries = goProfiles
		}
		out = append(out, ServiceProfile{
			Service: svc.Name,
			CPU:     p.render(svc.Name, queries.cpu),
			Heap:    p.render(svc.Name, queries.heap),
		})
	}
	return out, nil
}

// flamebearer is the shape Pyroscope's render endpoint answers with: a name
// table and one flat array per level, four numbers per node - the offset, the
// total samples, the self samples, and the index into the name table.
type flamebearer struct {
	Flamebearer struct {
		Names  []string  `json:"names"`
		Levels [][]int64 `json:"levels"`
	} `json:"flamebearer"`
}

// render asks for one profile window and folds it into a top-N self-time list.
func (p *Pyroscope) render(service, profile string) []ProfileEntry {
	params := url.Values{}
	now := time.Now()
	params.Set("query", fmt.Sprintf("%s{service_name=%q,langwatch_worktree=%q}", profile, service, p.worktree))
	params.Set("from", strconv.FormatInt(now.Add(-ProfileWindow).UnixMilli(), 10))
	params.Set("until", strconv.FormatInt(now.UnixMilli(), 10))
	params.Set("format", "json")
	var body flamebearer
	if err := p.api.getJSON("/pyroscope/render", params, &body); err != nil {
		return nil
	}
	return topSelf(body)
}

// nodeStride is how many numbers one flamebearer node occupies.
const nodeStride = 4

// topSelf sums self samples per function name and returns the biggest, as a
// share of the whole profile. Self time rather than total is the point: a list
// ordered by total is a list of every caller of the one hot function.
func topSelf(body flamebearer) []ProfileEntry {
	self := map[string]float64{}
	total := 0.0
	names := body.Flamebearer.Names
	for _, level := range body.Flamebearer.Levels {
		for i := 0; i+nodeStride <= len(level); i += nodeStride {
			index := int(level[i+3])
			if index < 0 || index >= len(names) {
				continue
			}
			value := float64(level[i+2])
			self[names[index]] += value
			total += value
		}
	}
	return rankShares(self, total)
}

// rankShares turns a name-to-samples map into the top entries by share.
func rankShares(self map[string]float64, total float64) []ProfileEntry {
	out := make([]ProfileEntry, 0, len(self))
	for name, value := range self {
		if value == 0 {
			continue
		}
		share := 0.0
		if total > 0 {
			share = value / total
		}
		out = append(out, ProfileEntry{Function: name, Share: share})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Share > out[j].Share })
	if len(out) > topFunctions {
		out = out[:topFunctions]
	}
	return out
}

// GrafanaURL opens one service's flame graph in the bundle's Grafana.
func (p *Pyroscope) GrafanaURL(service string) string {
	query := fmt.Sprintf("{service_name=%q,langwatch_worktree=%q}", service, p.worktree)
	return p.grafana + "/a/grafana-pyroscope-app/single?query=" + url.QueryEscape(query)
}
