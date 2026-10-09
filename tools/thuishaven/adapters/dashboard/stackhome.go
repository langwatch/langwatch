package dashboard

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// A surface's status. not-selected is a service this worktree opted out of,
// and it carries the `haven up +<name>` that turns it back on.
const (
	statusLive        = "live"
	statusStarting    = "starting"
	statusDown        = "down"
	statusNotSelected = "not-selected"
)

// recentErrorsPerLane caps each lane's error list on a stack home.
const recentErrorsPerLane = 20

// The JSON the stack home reads (apps/haven-web parses it with Zod; the
// shape tests in stackhome_test.go pin every field name).
type stackHomeJSON struct {
	Slug        string           `json:"slug"`
	Registered  bool             `json:"registered"`
	Live        bool             `json:"live"`
	HubURL      string           `json:"hubUrl"`
	HomeURL     string           `json:"homeUrl"`
	Facts       factsJSON        `json:"facts"`
	Surfaces    []surfaceJSON    `json:"surfaces"`
	Errors      []laneErrorsJSON `json:"errors"`
	Credentials credentialsJSON  `json:"credentials"`
	Actions     stackActionsJSON `json:"actions"`
	// BelowFloor is the upgrade gate's refusal while it holds the api, else "".
	BelowFloor string `json:"belowFloor"`
}

type factsJSON struct {
	Branch        string        `json:"branch"`
	WorktreeDir   string        `json:"worktreeDir"`
	Layout        string        `json:"layout"`
	Baseline      bool          `json:"baseline"`
	UptimeSeconds int64         `json:"uptimeSeconds"`
	RSSBytes      uint64        `json:"rssBytes"`
	HeartbeatAt   *time.Time    `json:"heartbeatAt"`
	Databases     databasesJSON `json:"databases"`
}

type databasesJSON struct {
	Postgres   databaseJSON `json:"postgres"`
	ClickHouse databaseJSON `json:"clickhouse"`
	Redis      redisJSON    `json:"redis"`
}

type databaseJSON struct {
	Name string `json:"name"`
	Port int    `json:"port"`
}

// redisJSON's DB is null for a stopped stack: the index is allocated at up.
type redisJSON struct {
	DB   *int `json:"db"`
	Port int  `json:"port"`
}

type surfaceJSON struct {
	Name     string `json:"name"`
	Role     string `json:"role"`
	Hostname string `json:"hostname"`
	URL      string `json:"url"`
	Port     int    `json:"port"`
	Status   string `json:"status"`
	Hint     string `json:"hint"`
	Fallback bool   `json:"fallback"`
	// Reason is the one line saying why a surface is not live, Detail the lane
	// line behind it, and Restart the `haven restart` name a row may bounce.
	Reason  string `json:"reason"`
	Detail  string `json:"detail"`
	Restart string `json:"restart"`
	// Start is the `haven up +<x>` name a Not selected row may add.
	Start string `json:"start"`
}

type laneErrorsJSON struct {
	Lane    string    `json:"lane"`
	LogsURL string    `json:"logsUrl"`
	Lines   []logLine `json:"lines"`
}

type credentialsJSON struct {
	Login       loginJSON   `json:"login"`
	MailAddress string      `json:"mailAddress"`
	IdPTenants  []IdPTenant `json:"idpTenants"`
	APIKey      *apiKeyJSON `json:"apiKey"`
}

type loginJSON struct {
	Email string `json:"email"`
}

// apiKeyJSON never carries the key: RevealPath is the POST that returns it.
type apiKeyJSON struct {
	Masked     string `json:"masked"`
	RevealPath string `json:"revealPath"`
}

type stackActionsJSON struct {
	CanRestart bool   `json:"canRestart"`
	CanStart   bool   `json:"canStart"`
	StartDir   string `json:"startDir"`
	// CanStartService offers Start on Not selected rows; CanResetDatabases the
	// below-floor callout's reset.
	CanStartService   bool `json:"canStartService"`
	CanResetDatabases bool `json:"canResetDatabases"`
}

// IdPTenant is one tenant of the IdP simulator a stack routes to.
type IdPTenant struct {
	ID     string `json:"id"`
	Domain string `json:"domain"`
	URL    string `json:"url"`
}

type notFoundJSON struct {
	Error  string `json:"error"`
	Slug   string `json:"slug"`
	HubURL string `json:"hubUrl"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) extras() Extras {
	if s.config.Extras == nil {
		return Extras{}
	}
	return s.config.Extras()
}

// stackURL is a routed URL through the live proxy, "" when unwired.
func (s *Server) stackURL(service, slug string) string {
	if s.config.StackURL == nil {
		return ""
	}
	return s.config.StackURL(service, slug)
}

func (s *Server) homeURL(slug string) string {
	name, ok := s.config.Naming.StackHomeService(slug)
	if !ok {
		return ""
	}
	return s.stackURL(name, "")
}

func (s *Server) hubURL() string { return s.config.SharedURL(domain.HubService) }

// homeState is one stack as a home or hub card reads it: registered is false
// for a worktree whose stack is down, and live is its launcher answering.
type homeState struct {
	stack      domain.Stack
	registered bool
	live       bool
}

func (s *Server) isLive(st domain.Stack) bool {
	if st.LauncherPID == 0 {
		return false
	}
	return s.config.Probes.ProcessAlive == nil || s.config.Probes.ProcessAlive(st.LauncherPID)
}

func (s *Server) portUp(port int) bool {
	return port != 0 && s.config.Probes.PortInUse != nil && s.config.Probes.PortInUse(port)
}

// findHome is the stack a home names: a registered one, else a worktree haven
// has named whose stack is down, which the home still answers for.
func (s *Server) findHome(slug string, extras Extras) (st domain.Stack, registered, found bool) {
	if !domain.ValidSlug(slug) {
		return domain.Stack{}, false, false
	}
	stacks := s.config.Stacks()
	for i := range stacks {
		if stacks[i].Slug == slug {
			return stacks[i], true, true
		}
	}
	for _, wt := range extras.Worktrees {
		if wt.Slug == slug {
			return domain.Stack{Slug: slug, Branch: wt.Branch, WorktreeDir: wt.Dir, Layout: detectLayout(wt.Dir)}, false, true
		}
	}
	return domain.Stack{}, false, false
}

func detectLayout(dir string) domain.Layout {
	return domain.DetectLayout(func(rel string) bool {
		_, err := os.Stat(filepath.Join(dir, rel))
		return err == nil
	})
}

func (s *Server) handleStackHome(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	extras := s.extras()
	st, registered, found := s.findHome(slug, extras)
	if !found {
		writeJSON(w, http.StatusNotFound, notFoundJSON{
			Error: fmt.Sprintf("no stack is registered for %q", slug), Slug: slug, HubURL: s.hubURL(),
		})
		return
	}
	h := homeState{stack: st, registered: registered, live: registered && s.isLive(st)}
	surfaces := s.surfaces(h)
	lanes, tails := s.laneTails(slug)
	explain(h, surfaces, tails)
	canRestart := h.live && s.config.Actions.Restart != nil
	for i := range surfaces {
		if !canRestart {
			surfaces[i].Restart = ""
		}
	}
	writeJSON(w, http.StatusOK, stackHomeJSON{
		Slug:        slug,
		Registered:  registered,
		Live:        h.live,
		HubURL:      s.hubURL(),
		HomeURL:     s.homeURL(slug),
		Facts:       s.facts(h, extras),
		Surfaces:    surfaces,
		Errors:      s.recentErrors(slug, lanes, tails),
		Credentials: s.credentials(r, h, surfaces),
		Actions: stackActionsJSON{
			CanRestart: canRestart,
			CanStart:   !h.live && s.config.Actions.Start != nil && st.WorktreeDir != "",
			StartDir:   st.WorktreeDir,

			CanStartService:   h.live && s.config.Actions.StartService != nil,
			CanResetDatabases: registered && s.config.Actions.ResetDatabases != nil,
		},
		BelowFloor: floorRefusal(surfaces, tails, st.Layout),
	})
}

// floorRefusal is the upgrade gate's refusal (code refused_below_floor) from
// the api's lanes while the api is not live, its msg field when it has one.
func floorRefusal(surfaces []surfaceJSON, tails map[string][]logLine, layout domain.Layout) string {
	for _, sf := range surfaces {
		if sf.Name != domain.APIService || sf.Status == statusLive {
			continue
		}
		for _, lane := range surfaceLanes(sf.Name, layout) {
			if line, ok := newestMentioning(tails[lane], "refused_below_floor"); ok {
				if rec, parsed := logfmt.Parse(line.Text); parsed && rec.Message != "" {
					return rec.Message
				}
				return line.Text
			}
		}
	}
	return ""
}

func newestMentioning(lines []logLine, needle string) (logLine, bool) {
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.Contains(lines[i].Text, needle) {
			return lines[i], true
		}
	}
	return logLine{}, false
}

func (s *Server) facts(h homeState, extras Extras) factsJSON {
	st := h.stack
	f := factsJSON{
		Branch: st.Branch, WorktreeDir: st.WorktreeDir, Layout: string(st.Layout.OrModular()), Baseline: st.IsBaseline,
		Databases: databasesJSON{
			Postgres:   databaseJSON{Name: st.PostgresDatabase, Port: st.PostgresPort},
			ClickHouse: databaseJSON{Name: st.ClickHouseDatabase, Port: st.ClickHouseHTTPPort},
			Redis:      redisJSON{Port: st.RedisPort},
		},
	}
	if !h.registered {
		// Down keeps the databases, so a stopped stack's are still worth naming.
		f.Databases.Postgres.Name = domain.DatabaseForSlug(st.Slug)
		f.Databases.ClickHouse.Name = domain.DatabaseForSlug(st.Slug)
		return f
	}
	db := st.RedisDB
	f.Databases.Redis.DB = &db
	if !st.UpdatedAt.IsZero() {
		at := st.UpdatedAt
		f.HeartbeatAt = &at
	}
	if h.live {
		f.RSSBytes = extras.StackRSS[st.LauncherPID]
		f.UptimeSeconds = int64(extras.StackUptime[st.LauncherPID] / time.Second)
	}
	return f
}

// surfaces lists every surface a stack can have, in launch order, the API and
// worker right under the app they belong to and the shared Grafana last.
func (s *Server) surfaces(h homeState) []surfaceJSON {
	st := h.stack
	out := make([]surfaceJSON, 0, len(domain.PerWorktreeServices)+3)
	for _, planned := range domain.PerWorktreeServices {
		out = append(out, s.routedSurface(h, planned.Name, planned.Role))
		if planned.Name == "app" && !st.Layout.IsMonolith() {
			out = append(out, s.apiSurface(h), s.workerSurface(h))
		}
	}
	grafana := surfaceJSON{
		Name: domain.ObservabilityService, Role: "Grafana, shared by every stack", Status: statusDown,
		Hostname: s.config.Naming.Hostname(domain.ObservabilityService, ""), URL: s.config.SharedURL(domain.ObservabilityService),
		Port: st.ObservabilityGrafanaPort,
	}
	if h.registered && s.portUp(st.ObservabilityGrafanaPort) {
		grafana.Status = statusLive
	}
	return append(out, grafana)
}

func findService(st domain.Stack, name string) (domain.Service, bool) {
	for _, svc := range st.Services {
		if svc.Name == name {
			return svc, true
		}
	}
	return domain.Service{}, false
}

func (s *Server) routedSurface(h homeState, name, role string) surfaceJSON {
	st := h.stack
	out := surfaceJSON{Name: name, Role: role, Hostname: s.config.Naming.Hostname(name, st.Slug), URL: s.stackURL(name, st.Slug)}
	svc, has := findService(st, name)
	if has {
		out.Hostname, out.Port, out.Fallback = svc.Hostname, svc.Port, svc.IsFallback
		if svc.URL != "" {
			out.URL = svc.URL
		}
	}
	isSelected := name == "app" || (has && (svc.Port != 0 || svc.IsFallback))
	switch {
	case !h.registered:
		out.Status = statusDown
	case !isSelected:
		out.Status, out.Hint = statusNotSelected, "haven up +"+domain.CLIServiceNameForLayout(name, st.Layout)
	case svc.IsFallback:
		out.Status = statusDown
		if s.portUp(svc.Port) {
			out.Status = statusLive
		}
	default:
		out.Status = s.laneStatus(h.live, out.Port)
	}
	return out
}

func (s *Server) apiSurface(h homeState) surfaceJSON {
	st := h.stack
	out := surfaceJSON{
		Name: domain.APIService, Role: "API", Port: st.APIPort,
		Hostname: s.config.Naming.Hostname(domain.APIService, st.Slug), URL: s.stackURL(domain.APIService, st.Slug),
	}
	if svc, has := findService(st, domain.APIService); has && svc.URL != "" {
		out.Hostname, out.URL = svc.Hostname, svc.URL
	}
	out.Status = statusDown
	if h.registered {
		out.Status = s.laneStatus(h.live, st.APIPort)
	}
	return out
}

// workerSurface has no hostname: the worker serves no browser traffic, and
// its metrics listener is what says it is up.
func (s *Server) workerSurface(h homeState) surfaceJSON {
	out := surfaceJSON{Name: "worker", Role: "Worker: queues, projections, subscribers", Port: h.stack.WorkerMetricsPort, Status: statusDown}
	if h.registered {
		out.Status = s.laneStatus(h.live, h.stack.WorkerMetricsPort)
	}
	return out
}

// laneStatus is a selected surface of a registered stack: live once its port
// answers, starting while the launcher lives but the port does not yet.
func (s *Server) laneStatus(live bool, port int) string {
	switch {
	case !live:
		return statusDown
	case s.portUp(port):
		return statusLive
	default:
		return statusStarting
	}
}

// laneTails is each captured lane's tail, read once per request for both the
// recent errors and the surfaces' reasons.
func (s *Server) laneTails(slug string) ([]string, map[string][]logLine) {
	tails := map[string][]logLine{}
	if s.config.LogDir == nil {
		return nil, tails
	}
	root, err := openStackLogs(s.config.LogDir(slug))
	if err != nil {
		return nil, tails
	}
	defer func() { _ = root.Close() }()
	lanes, err := captureNames(root)
	if err != nil {
		return nil, tails
	}
	var read []string
	for _, lane := range lanes {
		if lines, readErr := readServiceTail(root, lane); readErr == nil {
			read = append(read, lane)
			tails[lane] = lines
		}
	}
	return read, tails
}

// recentErrors is each lane's newest error and fatal lines, newest first.
// Lanes with none are left out; a stack with no captured logs has none.
func (s *Server) recentErrors(slug string, lanes []string, tails map[string][]logLine) []laneErrorsJSON {
	out := []laneErrorsJSON{}
	for _, lane := range lanes {
		if errs := newestErrors(tails[lane]); len(errs) > 0 {
			out = append(out, laneErrorsJSON{Lane: lane, LogsURL: s.logsURL(slug, lane), Lines: errs})
		}
	}
	return out
}

// simulators run in the sims lane (or the go lane); app/restart.go decides
// which from a checkout file, so a row offers no restart of its own for them.
var simulators = map[string]bool{
	domain.IdPService: true, domain.MailService: true, domain.StorageService: true, domain.VoiceService: true,
	domain.LLMService: true, domain.AnalyticsService: true, domain.OutboundService: true, domain.PaymentService: true, domain.TelemetryService: true,
}

// surfaceLanes are the captures a surface's process may write to: a
// one-process stack writes ui, api and worker to one, its name by version.
func surfaceLanes(name string, layout domain.Layout) []string {
	switch {
	case name == "app":
		return []string{domain.MonolithAppLane, "ui"}
	case name == domain.APIService || name == "worker":
		return []string{"api", "backend", domain.MonolithAppLane}
	case simulators[name]:
		return []string{name, "sims", "go"}
	case !layout.IsMonolith() && (name == "gateway" || name == "nlp"):
		return []string{"go"}
	}
	return []string{name, domain.CLIServiceNameForLayout(name, layout)}
}

// restartName is the `haven restart` name that bounces a surface's process.
func restartName(name string, layout domain.Layout) string {
	switch {
	case name == domain.ObservabilityService || simulators[name]:
		return ""
	case layout.IsMonolith():
		return domain.CLIServiceNameForLayout(name, layout)
	case name == domain.APIService || name == "worker":
		return "api"
	case name == "gateway" || name == "nlp":
		return "go"
	}
	return domain.CLIServiceNameForLayout(name, layout)
}

// tellingLine is the newest warning or worse in whichever candidate lane
// wrote last (a stale capture from an earlier layout loses), else its last line.
func tellingLine(tails map[string][]logLine, lanes []string) (string, logLine, bool) {
	lane, newest := "", []logLine(nil)
	for _, l := range lanes {
		if lines := tails[l]; len(lines) > 0 && (len(newest) == 0 || lines[len(lines)-1].At.After(newest[len(newest)-1].At)) {
			lane, newest = l, lines
		}
	}
	if len(newest) == 0 {
		return "", logLine{}, false
	}
	for i := len(newest) - 1; i >= 0; i-- {
		if level := logfmt.Level(newest[i].Level); level == logfmt.LevelWarn || level == logfmt.LevelError || level == logfmt.LevelFatal {
			return lane, newest[i], true
		}
	}
	return lane, newest[len(newest)-1], true
}

// explain fills each surface's reason from what the request already read:
// its status, its port and its lane's capture. Nothing is probed again.
func explain(h homeState, surfaces []surfaceJSON, tails map[string][]logLine) {
	for i := range surfaces {
		sf := &surfaces[i]
		if sf.Status != statusNotSelected {
			sf.Restart = restartName(sf.Name, h.stack.Layout)
		} else {
			sf.Start = domain.CLIServiceNameForLayout(sf.Name, h.stack.Layout)
		}
		reason, isWaiting := reasonFor(h, *sf)
		sf.Reason = reason
		if sf.Name == domain.ObservabilityService && reason != "" {
			sf.Detail = "Grafana is machine-wide, not this stack's: `haven restart obs` brings it back"
		}
		if isWaiting {
			addLaneLine(sf, tails, h.stack.Layout)
		}
	}
}

// addLaneLine appends what the surface's lane said last that matters.
func addLaneLine(sf *surfaceJSON, tails map[string][]logLine, layout domain.Layout) {
	lane, line, ok := tellingLine(tails, surfaceLanes(sf.Name, layout))
	if !ok {
		return
	}
	message := line.Text
	if rec, parsed := logfmt.Parse(line.Text); parsed && rec.Message != "" {
		message = rec.Message
	}
	sf.Reason += "; " + lane + " says: " + message
	sf.Detail = line.At.Format(time.RFC3339) + " " + lane + ": " + line.Text
}

// reasonFor is a surface's one line, and whether its own lane's log can say more.
func reasonFor(h homeState, sf surfaceJSON) (string, bool) {
	switch {
	case sf.Status == statusLive:
		return "", false
	case sf.Name == domain.ObservabilityService:
		return fmt.Sprintf("shared by every stack; nothing answers on :%d", sf.Port), false
	case sf.Status == statusNotSelected:
		return "not part of this stack; start it with " + sf.Hint, false
	case !h.registered:
		return "the stack is stopped", false
	case !h.live:
		return "the stack's launcher is gone", false
	case sf.Name == domain.APIService && sf.Status == statusStarting:
		return "waiting for " + h.stack.HealthProbeURL(), true
	case sf.Status == statusStarting:
		return fmt.Sprintf("waiting for :%d to answer", sf.Port), true
	}
	return fmt.Sprintf("nothing answers on :%d", sf.Port), true
}

func newestErrors(lines []logLine) []logLine {
	var out []logLine
	for i := len(lines) - 1; i >= 0 && len(out) < recentErrorsPerLane; i-- {
		if level := logfmt.Level(lines[i].Level); level == logfmt.LevelError || level == logfmt.LevelFatal {
			out = append(out, lines[i])
		}
	}
	return out
}

// logsURL is the hub's log view for one stack's lane, a route apps/haven-web serves.
func (s *Server) logsURL(slug, lane string) string {
	return strings.TrimRight(s.hubURL(), "/") + "/logs/" + url.PathEscape(slug) + "/" + url.PathEscape(lane)
}

func (s *Server) credentials(r *http.Request, h homeState, surfaces []surfaceJSON) credentialsJSON {
	st := h.stack
	c := credentialsJSON{
		Login:       loginJSON{Email: domain.DefaultAdminEmail},
		MailAddress: s.config.Naming.MailAddress(st.Slug),
		IdPTenants:  []IdPTenant{},
	}
	if h.registered && st.LocalAPIKey != "" {
		c.APIKey = &apiKeyJSON{Masked: maskKey(st.LocalAPIKey), RevealPath: "/api/stacks/" + st.Slug + "/api-key"}
	}
	for _, sf := range surfaces {
		if sf.Name == domain.IdPService && sf.Status == statusLive && s.config.IdPTenants != nil {
			if tenants := s.config.IdPTenants(r.Context(), sf.Port); tenants != nil {
				c.IdPTenants = tenants
			}
		}
	}
	return c
}

// maskKey keeps enough of a key to tell it apart, its prefix and last four,
// without printing it. A key too short to keep both is masked whole.
func maskKey(key string) string {
	const prefix, suffix, mask = 6, 4, "••••••••"
	if len(key) < prefix+suffix+6 {
		return mask
	}
	return key[:prefix] + mask + key[len(key)-suffix:]
}

// handleRevealAPIKey answers the copy button: the one place the key leaves
// the daemon, same-origin POST only, and never logged.
func (s *Server) handleRevealAPIKey(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	slug := r.PathValue("slug")
	stacks := s.config.Stacks()
	for i := range stacks {
		if stacks[i].Slug == slug && stacks[i].LocalAPIKey != "" {
			writeJSON(w, http.StatusOK, map[string]string{"apiKey": stacks[i].LocalAPIKey})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, notFoundJSON{
		Error: fmt.Sprintf("no stack is registered for %q", slug), Slug: slug, HubURL: s.hubURL(),
	})
}
