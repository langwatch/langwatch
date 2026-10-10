package dashboard

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// maxHubEvents caps the daemon's reclamations the hub lists, newest first.
const maxHubEvents = 12

// analyticsTimeout bounds the whole fan-out to the stacks' analyticssims, so a
// stuck sim never slows /api/hub.
const analyticsTimeout = 300 * time.Millisecond

// The JSON the hub reads: the whole machine apps/haven-web draws, as raw
// values (bytes, seconds, RFC 3339 times) rather than display strings.
type hubJSON struct {
	Shared    sharedJSON        `json:"shared"`
	Machine   machineJSON       `json:"machine"`
	Stacks    []hubStackJSON    `json:"stacks"`
	Worktrees []hubWorktreeJSON `json:"worktrees"`
	Events    []hubEventJSON    `json:"events"`
	Actions   hubActionsJSON    `json:"actions"`
}

type sharedJSON struct {
	HubURL           string `json:"hubUrl"`
	ObservabilityURL string `json:"observabilityUrl"`
	TelemetryURL     string `json:"telemetryUrl"`
}

type machineJSON struct {
	TotalRAMBytes   uint64            `json:"totalRamBytes"`
	DevRSSBytes     uint64            `json:"devRssBytes"`
	StacksRSSBytes  uint64            `json:"stacksRssBytes"`
	ServerRSSBytes  map[string]uint64 `json:"serverRssBytes"`
	AgentRSSBytes   uint64            `json:"agentRssBytes"`
	AgentCount      int               `json:"agentCount"`
	ToolingRSSBytes uint64            `json:"toolingRssBytes"`
	OtherRSSBytes   uint64            `json:"otherRssBytes"`
	Pressure        string            `json:"pressure"`
}

type hubStackJSON struct {
	Slug       string        `json:"slug"`
	Live       bool          `json:"live"`
	HomeURL    string        `json:"homeUrl"`
	AppURL     string        `json:"appUrl"`
	Facts      factsJSON     `json:"facts"`
	Surfaces   []surfaceJSON `json:"surfaces"`
	CanRestart bool          `json:"canRestart"`
	CanDown    bool          `json:"canDown"`
	CanDestroy bool          `json:"canDestroy"`
	// Analytics is the stack's analyticssim activity; absent when it has no sim or the sim did not answer.
	Analytics *hubAnalyticsJSON `json:"analytics,omitempty"`
}

// hubAnalyticsJSON is the activity part of analyticssim's GET /_sim/api/status.
type hubAnalyticsJSON struct {
	Total           int        `json:"total"`
	LastFiveMinutes int        `json:"lastFiveMinutes"`
	DistinctIDs     int        `json:"distinctIds"`
	LastReceivedAt  *time.Time `json:"lastReceivedAt"`
	LastName        string     `json:"lastName"`
}

type hubWorktreeJSON struct {
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Branch    string `json:"branch"`
	Dir       string `json:"dir"`
	IsPrimary bool   `json:"isPrimary"`
	IsCurrent bool   `json:"isCurrent"`
	HomeURL   string `json:"homeUrl"`
	CanStart  bool   `json:"canStart"`
}

type hubEventJSON struct {
	At     *time.Time `json:"at"`
	Kind   string     `json:"kind"`
	Target string     `json:"target"`
	Reason string     `json:"reason"`
}

type hubActionsJSON struct {
	CanRestart bool `json:"canRestart"`
	CanStart   bool `json:"canStart"`
}

func (s *Server) handleHub(w http.ResponseWriter, r *http.Request) {
	extras := s.extras()
	writeJSON(w, http.StatusOK, hubJSON{
		Shared: sharedJSON{
			HubURL:           s.hubURL(),
			ObservabilityURL: s.config.SharedURL(domain.ObservabilityService),
			TelemetryURL:     s.config.SharedURL("telemetry"),
		},
		Machine:   machineView(extras.Summary),
		Stacks:    s.hubStacks(r.Context(), extras),
		Worktrees: s.hubWorktrees(extras.Worktrees),
		Events:    hubEvents(extras.Events),
		Actions:   hubActionsJSON{CanRestart: s.config.Actions.Restart != nil, CanStart: s.config.Actions.Start != nil},
	})
}

func machineView(sum SummaryView) machineJSON {
	servers := sum.ServerRSS
	if servers == nil {
		servers = map[string]uint64{}
	}
	return machineJSON{
		TotalRAMBytes: sum.TotalRAM, DevRSSBytes: sum.DevRSS(), StacksRSSBytes: sum.StacksRSS,
		ServerRSSBytes: servers, AgentRSSBytes: sum.AgentRSS, AgentCount: sum.AgentCount,
		ToolingRSSBytes: sum.ToolingRSS, OtherRSSBytes: sum.OtherRSS, Pressure: sum.Pressure,
	}
}

func (s *Server) hubStacks(ctx context.Context, extras Extras) []hubStackJSON {
	out := []hubStackJSON{}
	// By name, so a stack doesn't jump about the hub each time it's touched;
	// the registry itself hands them back most recently updated first.
	stacks := slices.SortedStableFunc(slices.Values(s.config.Stacks()), func(a, b domain.Stack) int {
		return strings.Compare(a.Slug, b.Slug)
	})
	for i := range stacks {
		h := homeState{stack: stacks[i], registered: true, live: s.isLive(stacks[i])}
		out = append(out, hubStackJSON{
			Slug: stacks[i].Slug, Live: h.live, HomeURL: s.homeURL(stacks[i].Slug), AppURL: appURL(stacks[i]),
			Facts:      s.facts(h, extras),
			Surfaces:   s.surfaces(h),
			CanRestart: h.live && s.config.Actions.Restart != nil,
			CanDown:    s.config.Actions.Down != nil,
			CanDestroy: s.config.Actions.Destroy != nil,
		})
	}
	fillAnalytics(ctx, stacks, out)
	return out
}

// fillAnalytics asks every live stack's analyticssim for its activity at once.
func fillAnalytics(ctx context.Context, stacks []domain.Stack, out []hubStackJSON) {
	ctx, cancel := context.WithTimeout(ctx, analyticsTimeout)
	defer cancel()
	var wg sync.WaitGroup
	for i := range stacks {
		svc, has := findService(stacks[i], domain.AnalyticsService)
		if out[i].Live && has && svc.Port != 0 {
			wg.Go(func() { out[i].Analytics = fetchAnalytics(ctx, svc.Port) })
		}
	}
	wg.Wait()
}

// fetchAnalytics is the sim's activity over loopback, or nil on any failure.
func fetchAnalytics(ctx context.Context, port int) *hubAnalyticsJSON {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/_sim/api/status", port), nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	var status struct {
		Activity *hubAnalyticsJSON `json:"activity"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&status) != nil {
		return nil
	}
	return status.Activity
}

func (s *Server) hubWorktrees(worktrees []WorktreeView) []hubWorktreeJSON {
	out := []hubWorktreeJSON{}
	for _, wt := range worktrees {
		name := wt.Slug
		if name == "" {
			name = filepath.Base(wt.Dir)
		}
		out = append(out, hubWorktreeJSON{
			Name: name, Slug: wt.Slug, Branch: wt.Branch, Dir: wt.Dir,
			IsPrimary: wt.IsPrimary, IsCurrent: wt.IsCurrent,
			HomeURL: s.homeURL(wt.Slug), CanStart: s.config.Actions.Start != nil,
		})
	}
	return out
}

func hubEvents(events []EventView) []hubEventJSON {
	out := []hubEventJSON{}
	for _, ev := range events {
		if len(out) == maxHubEvents {
			break
		}
		row := hubEventJSON{Kind: ev.Kind, Target: ev.Target, Reason: ev.Reason}
		if !ev.At.IsZero() {
			at := ev.At
			row.At = &at
		}
		out = append(out, row)
	}
	return out
}
