package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// resolvedDevEnv is the environment the app process will actually see in this
// worktree: the operator's .env, overridden by whatever the shell that ran
// `haven up` already exports — the same precedence a dotenv loader gives a
// real env var. It exists to answer one question honestly (did the developer
// already configure an email provider?) without haven reading or writing
// anything to disk itself.
func resolvedDevEnv(repoDir string) map[string]string {
	resolved := domain.LoadDotenv(repoDir)
	for _, kv := range os.Environ() {
		if key, val, ok := strings.Cut(kv, "="); ok && val != "" {
			resolved[key] = val
		}
	}
	return resolved
}

// palette gives each supervised child a distinct prefix color.
var palette = []string{"32", "34", "33", "35", "36", "31", "92", "94", "96", "95"}

// goServiceShell picks `make service` (go run) or `make service-watch` (air) for
// a Go service — the "run vs watch" decision the orchestrator owns.
func goServiceShell(repoRoot, svc string, shouldWatch bool) string {
	target := "service"
	if shouldWatch {
		target = "service-watch"
	}
	return fmt.Sprintf("make -C %q %s svc=%s", repoRoot, target, svc)
}

func (o *Orchestrator) simulatorShell(name string) string {
	args := make([]string, 0, len(o.cfg.SimulatorArgv)+1)
	for _, arg := range o.cfg.SimulatorArgv {
		args = append(args, shQuote(arg))
	}
	args = append(args, shQuote(name))
	return "exec " + strings.Join(args, " ")
}

// goCombinedShell runs the data-plane services in ONE Go process — the local
// topology (ADR-004, amendment 2026-09-07). `services` names which of them this
// stack selected, so a worktree that turned one off gets a process hosting only
// the other rather than a second lane it has to reason about.
//
// Watching is air: it rebuilds the one binary on a Go change, restarts only
// when the build succeeded, and waits out the same quiet window the Node lane
// debounces on (LANGWATCH_DEV_WATCH_DEBOUNCE_MS).
func goCombinedShell(repoRoot string, services []string, shouldWatch bool) string {
	target := "service"
	if shouldWatch {
		target = "service-watch"
	}
	return fmt.Sprintf("make -C %q %s svc=combined args=%q", repoRoot, target, strings.Join(services, " "))
}

// SimulatorsInGoFile is the dev-tagged file that links the simulators into the
// checkout's mono-binary. A checkout without it (older, or monolith) has no
// simulator of its own, so Haven runs its bundled copies instead.
const SimulatorsInGoFile = "cmd/service/combined_dev.go"

// goLaneHostsSimulators reports whether the checkout's go lane can host them.
func goLaneHostsSimulators(repoRoot string) bool {
	_, err := os.Stat(filepath.Join(repoRoot, SimulatorsInGoFile))
	return err == nil
}

// idpEnv is idpsim's own configuration, wherever it runs. The issuer/metadata
// URLs it publishes must be the routed hostname, not loopback: the browser
// follows them during a login. Its nameserver answers whatever it is asked, so
// it binds loopback rather than the wildcard it defaults to.
func (o *Orchestrator) idpEnv(st domain.Stack) []string {
	env := []string{"IDPSIM_DATA_DIR=" + filepath.Join(o.cfg.Home, "idp", st.Slug)}
	for _, svc := range st.Services {
		if svc.Name != domain.IdPService {
			continue
		}
		if svc.URL != "" {
			env = append(env, "IDPSIM_BASE_URL="+svc.URL)
		}
		if svc.DNSPort != 0 {
			env = append(env, fmt.Sprintf("IDPSIM_DNS_ADDR=127.0.0.1:%d", svc.DNSPort))
		}
	}
	return env
}

// mailEnv is mailsim's own configuration, wherever it runs. Messages persist
// per slug (MAILSIM_DATA_DIR) and are pruned only with the worktree's state.
func (o *Orchestrator) mailEnv(st domain.Stack) []string {
	var httpPort, smtpPort int
	var mailURL string
	for _, svc := range st.Services {
		if svc.Name == domain.MailService {
			httpPort, smtpPort, mailURL = svc.Port, svc.SMTPPort, svc.URL
		}
	}
	mailDataDir := filepath.Join(o.cfg.Home, "mail", st.Slug)
	_ = os.MkdirAll(mailDataDir, 0o755)
	env := []string{
		fmt.Sprintf("MAILSIM_HTTP_ADDR=:%d", httpPort),
		fmt.Sprintf("MAILSIM_SMTP_ADDR=:%d", smtpPort),
		"MAILSIM_DATA_DIR=" + mailDataDir,
		"MAILSIM_SEED=1",
	}
	if mailURL != "" {
		env = append(env, "MAILSIM_BASE_URL="+mailURL)
	}
	return env
}

// planChildren turns a resolved stack into the supervised process set, layering
// the overlay env (hostname URLs + ports) onto each child and giving each Go
// service its SERVER_ADDR.
func (o *Orchestrator) planChildren(st domain.Stack, opts PlanOptions, repoDir string) []Child {
	p := o.newChildPlan(st, opts, repoDir)
	// A monolith checkout has neither Node package: one process serves the
	// browser application and its API, so the ui lane below and the backend
	// lane at the end are replaced by the single app lane. See plan_monolith.go.
	mono := monolithPlan{
		Stack: st, Opts: opts, RepoDir: repoDir, Base: p.base,
		NodeEnv: p.nodeEnv, LogPath: p.logPath, Port: p.port,
	}
	isOneProcess := !st.Layout.IsMonolith() && opts.ShouldRunOneProcess
	out := []Child{p.frontChild(mono, isOneProcess)}
	out = append(out, p.goLanes(mono)...)
	out = append(out, p.devToolChildren()...)
	if opts.Selection.Langevals {
		out = append(out, p.langevalsChild())
	}
	if opts.Selection.Langy {
		langy := o.langyChild(st, opts, p.base, p.port("langyagent"), opts.langyDockerHost)
		langy.LogPath = p.logPath("langyagent")
		out = append(out, langy)
	}
	if st.Layout.IsMonolith() || isOneProcess {
		return out
	}
	return append(out, p.backendChild())
}

// childPlan is what every child of one stack is planned from: the stack, the
// options, the checkout and the env every lane starts with.
type childPlan struct {
	o       *Orchestrator
	st      domain.Stack
	opts    PlanOptions
	repoDir string
	logDir  string
	base    []string
}

func (o *Orchestrator) newChildPlan(st domain.Stack, opts PlanOptions, repoDir string) *childPlan {
	p := &childPlan{o: o, st: st, opts: opts, repoDir: repoDir}
	p.logDir, _ = domain.StackLogPaths(st.WorktreeDir, st.Slug)
	p.base = append(st.OverlayEnv(), o.credentialEnv(st.Slug, repoDir)...)
	// Bun and Node use their own bundled CA roots, NOT the macOS system store, so
	// the app process and the langy worker (Bun) subprocess otherwise
	// reject the portless HTTPS certs on every gateway/control-plane call ("self
	// signed certificate in certificate chain"). Point them at the portless Local
	// CA so those runtimes trust the same hostnames curl/Go/the browser already do.
	// Dev/portless only — production serves real certs, and CACertPath is "" when
	// the CA is absent, so this appends nothing outside a portless stack.
	if ca := o.proxy.CACertPath(); ca != "" {
		p.base = append(p.base, "NODE_EXTRA_CA_CERTS="+ca)
	}
	// The simulators' provider settings (mail, storage, voice, analytics, LLM),
	// computed before `base` feeds the ui/backend lanes (and mono's own copy)
	// below, so a monolith checkout's one lane gets them too.
	for _, name := range []string{domain.MailService, domain.StorageService, domain.VoiceService, domain.AnalyticsService, domain.LLMService} {
		for _, svc := range st.Services {
			if svc.Name == name {
				p.base = append(p.base, simulatorBaseEnv(opts.Selection, svc, repoDir)...)
			}
		}
	}
	return p
}

// simulatorBaseEnv points the product at a selected simulator — but never over
// a provider the developer configured explicitly (see domain.MailSMTPEnv,
// domain.StorageS3Env, domain.VoiceProviderEnv, domain.AnalyticsProviderEnv and
// domain.LLMProviderEnv): haven must not silently rewire what they deliberately
// routed elsewhere.
func simulatorBaseEnv(sel domain.Selection, svc domain.Service, repoDir string) []string {
	switch {
	case svc.Name == domain.MailService && sel.Mail && svc.SMTPPort != 0:
		return domain.MailSMTPEnv(resolvedDevEnv(repoDir), svc.SMTPPort)
	case svc.Name == domain.StorageService && sel.Storage && svc.Port != 0:
		return domain.StorageS3Env(resolvedDevEnv(repoDir), svc.URL)
	case svc.Name == domain.VoiceService && sel.Voice && svc.Port != 0:
		return domain.VoiceProviderEnv(resolvedDevEnv(repoDir), svc.Port)
	case svc.Name == domain.AnalyticsService && sel.Analytics && svc.Port != 0:
		return domain.AnalyticsProviderEnv(resolvedDevEnv(repoDir), svc.URL)
	case svc.Name == domain.LLMService && sel.LLM && svc.Port != 0:
		return domain.LLMProviderEnv(resolvedDevEnv(repoDir), svc.Port)
	}
	return nil
}

func (p *childPlan) logPath(name string) string {
	return filepath.Join(p.logDir, name+".log")
}

func (p *childPlan) port(name string) int {
	for _, s := range p.st.Services {
		if s.Name == name {
			return s.Port
		}
	}
	return 0
}

// nodeEnv is a Node lane's env. `pnpm -s` drops the `> pkg@ver script`
// lifecycle banner; DOTENV_CONFIG_QUIET silences dotenv v17's promo line for
// lanes that load it via `import "dotenv/config"`. Together with the `quiet:
// true` passed in server.mts / vite.config.ts, this keeps every Node lane
// starting on real logs — matching the Go services' clean startup.
func (p *childPlan) nodeEnv(lane string) []string {
	env := append(domain.LaneDatabaseEnv(p.base, lane),
		"NODE_ENV=development", "DOTENV_CONFIG_QUIET=true", domain.LaneEnv(lane),
		p.o.compileCacheEnv(p.st.Slug))
	if lane == "ui" || lane == AppLane {
		env = append(env, "LANGWATCH_VITE_NO_POLLING=1")
	}
	return env
}

// frontChild is the lane serving the browser application: the monolith's app
// lane, the one-process app lane, or the ui lane.
func (p *childPlan) frontChild(mono monolithPlan, isOneProcess bool) Child {
	switch {
	case p.st.Layout.IsMonolith():
		return mono.appChild()
	case isOneProcess:
		return oneProcessChild(p.repoDir, p.nodeEnv(AppLane), p.logPath(AppLane))
	}
	return Child{
		Name: "ui", Dir: p.repoDir, Color: palette[1], LogPath: p.logPath("ui"),
		Shell: "pnpm --silent --filter " + UIPackage + " dev",
		Env:   p.nodeEnv("ui"),
		// No readiness probe: the browser application holds the reader on its
		// own waiting screen until the API answers, so serving it first is the
		// boot the reader should see. specs/ui/api-boot-wait.feature.
	}
}

// goLanes is the Go lane, the simulators' lane and any simulator run as its
// own lane.
//
// One Go lane hosts whichever data-plane services this stack selected. Each
// still binds the port haven allocated for its hostname: SERVER_ADDR cannot
// answer for two listeners in one process, so each has its own address
// variable. A checkout whose dev build links the simulators hosts them there
// too; any other runs Haven's bundled copies as their own lanes.
func (p *childPlan) goLanes(mono monolithPlan) []Child {
	var out []Child
	goServices, goEnv := p.goServices()
	if p.st.Layout.IsMonolith() {
		out = append(out, mono.goChildren()...)
	} else if len(goServices) > 0 {
		out = append(out, Child{
			Name: GoLane, Dir: p.opts.RepoRoot, Color: palette[2], LogPath: p.logPath(GoLane),
			Shell: goCombinedShell(p.opts.RepoRoot, goServices, p.opts.ShouldGoWatch),
			Env:   goEnv,
		})
	}
	sims := p.planSimulators()
	if len(sims.services) > 0 {
		out = append(out, Child{
			Name: SimsLane, Dir: p.opts.RepoRoot, Color: palette[8], LogPath: p.logPath(SimsLane),
			Shell: goCombinedShell(p.opts.RepoRoot, sims.services, p.opts.ShouldGoWatch),
			Env:   sims.env,
		})
	}
	return append(out, sims.children...)
}

// goServices is the data-plane services the Go lane hosts, and its env.
func (p *childPlan) goServices() ([]string, []string) {
	var services []string
	env := append(append([]string{}, p.base...), domain.LaneEnv(GoLane))
	if p.opts.Selection.Gateway {
		services = append(services, "aigateway")
		env = append(env, fmt.Sprintf("%s=:%d", GatewayAddrEnv, p.port("gateway")))
	}
	if p.opts.Selection.NLP {
		services = append(services, "nlpgo")
		env = append(env, fmt.Sprintf("%s=:%d", NLPAddrEnv, p.port("nlp")))
	}
	return services, env
}

// simulatorPlan is where the selected simulators run: inside the sims lane
// (services, with env) or each as a lane of its own (children).
type simulatorPlan struct {
	inGo     bool
	services []string
	env      []string
	children []Child
}

// host places one selected simulator in the sims lane or as its own lane.
func (sp *simulatorPlan) host(binary string, env func() []string, child func() Child) {
	if sp.inGo {
		sp.services = append(sp.services, binary)
		sp.env = append(sp.env, env()...)
		return
	}
	sp.children = append(sp.children, child())
}

// planSimulators places every selected simulator. The linked simulators get a
// lane of their own, so a simulator under load cannot starve the gateway: a
// second `service combined` process.
func (p *childPlan) planSimulators() simulatorPlan {
	o, st, sel, repoRoot, base := p.o, p.st, p.opts.Selection, p.opts.RepoRoot, p.base
	sp := simulatorPlan{
		inGo: !st.Layout.IsMonolith() && goLaneHostsSimulators(repoRoot),
		env:  append(append([]string{}, base...), domain.LaneEnv(SimsLane)),
	}
	if sel.IDP {
		idpEnv := o.idpEnv(st)
		sp.host("idpsim", func() []string { return append(idpEnv, fmt.Sprintf("%s=:%d", IDPAddrEnv, p.port("idp"))) }, func() Child {
			return Child{
				Name: "idp", Dir: repoRoot, Color: palette[6], LogPath: p.logPath("idp"),
				Shell: o.simulatorShell("idp"),
				Env: append(append(append([]string{}, base...), idpEnv...),
					fmt.Sprintf("SERVER_ADDR=:%d", p.port("idp")), domain.LaneEnv("idp")),
			}
		})
	}
	if sel.Mail {
		mailEnv := o.mailEnv(st)
		sp.host("mailsim", func() []string { return mailEnv }, func() Child {
			return Child{
				Name: "mail", Dir: repoRoot, Color: palette[7], LogPath: p.logPath("mail"),
				Shell: o.simulatorShell("mail"),
				Env:   append(append(append([]string{}, base...), domain.LaneEnv("mail")), mailEnv...),
			}
		})
	}
	p.hostBundledSimulators(&sp)
	return sp
}

// hostBundledSimulators places storage, voice, LLM and analytics, in that order.
func (p *childPlan) hostBundledSimulators(sp *simulatorPlan) {
	o, st, sel, repoRoot, base := p.o, p.st, p.opts.Selection, p.opts.RepoRoot, p.base
	for _, sim := range []struct {
		isSelected bool
		binary     string
		env        func() []string
		child      func() Child
	}{
		{sel.Storage, "storagesim", func() []string { return o.storageEnv(st) }, func() Child { return o.storageChild(st, repoRoot, base) }},
		{sel.Voice, "voicesim", func() []string { return voiceEnv(st) }, func() Child { return o.voiceChild(st, repoRoot, base) }},
		{sel.LLM, "llmsim", func() []string { return llmEnv(st) }, func() Child { return o.llmChild(st, repoRoot, base) }},
		{sel.Analytics, "analyticssim", func() []string { return analyticsEnv(st) }, func() Child { return o.analyticsChild(st, repoRoot, base) }},
	} {
		if sim.isSelected {
			sp.host(sim.binary, sim.env, sim.child)
		}
	}
}

// devToolChildren is the two developer tools. Neither is a Node LANE — nothing
// in the product degrades without them — so they are planned like the Go
// services: only when the worktree has selected them, and never counted among
// the three. Each is handed the port haven allocated for its hostname, on the
// command line, because both tools otherwise bind a fixed default that a
// second worktree would find busy.
func (p *childPlan) devToolChildren() []Child {
	var out []Child
	if p.opts.Selection.DesignSystem {
		out = append(out, Child{
			Name: domain.DesignSystemService, Dir: p.repoDir, Color: palette[8], LogPath: p.logPath(domain.DesignSystemService),
			Shell: fmt.Sprintf("pnpm --silent --filter %s storybook --port %d --ci",
				DesignSystemPackage, p.port(domain.DesignSystemService)),
			Env: p.nodeEnv(domain.DesignSystemService),
		})
	}
	if p.opts.Selection.MailRoom {
		out = append(out, Child{
			Name: domain.MailRoomService, Dir: p.repoDir, Color: palette[9], LogPath: p.logPath(domain.MailRoomService),
			// --strictPort: vite silently moves to the next free port otherwise,
			// which would leave mail-room.<slug> routed to nothing at all.
			// --host 127.0.0.1: vite's default "localhost" binds only ::1 on
			// this machine, and the proxy and the port probe both dial IPv4.
			Shell: fmt.Sprintf("pnpm --silent --filter %s dev --host 127.0.0.1 --port %d --strictPort",
				MailPackage, p.port(domain.MailRoomService)),
			Env: p.nodeEnv(domain.MailRoomService),
		})
	}
	return out
}

// backendChild is the api lane.
func (p *childPlan) backendChild() Child {
	return Child{
		// green, not red: the backend is a healthy lane, and a red prefix reads
		// as an error even on ordinary info logs. Red (palette[5]) is reserved
		// for genuine failures, so no lane label uses it — TestNoLaneIsRed pins
		// that.
		//
		// Unconditional, and one lane: locally the API application and the
		// worker application share a process (ADR-004, amendment 2026-09-07).
		// It is a launcher, not a process role — each application still parses
		// its own configuration and composes its own graph, and nothing reads
		// WORKERS_IN_PROCESS or START_WORKERS. Production still deploys them
		// separately.
		Name: APILane, Dir: p.repoDir, Color: palette[0], LogPath: p.logPath(APILane),
		Shell: "pnpm --silent --filter " + BackendPackage + " dev",
		Env:   p.nodeEnv(APILane),
	}
}

// oneProcessChild is a modular checkout's ui and api lanes as one: the UI's
// Vite server, the api and the worker in one Node process, the backend
// reloaded in-process (ADR-168, B1). It still listens on the app port and the
// API port, so `haven restart ui|api` bounces it and the rows stay truthful.
// No readiness probe, as for the ui lane: the UI's boot-wait screen covers it.
func oneProcessChild(repoDir string, env []string, logPath string) Child {
	return Child{
		Name: AppLane, Dir: repoDir, Color: palette[1], LogPath: logPath,
		Shell: "pnpm --silent --filter " + BackendPackage + " dev:one",
		Env:   env,
	}
}

// The Node lanes a stack supervises, by workspace package name. planChildren
// runs each with `pnpm --filter <pkg> dev` from the workspace root, so the lane
// never depends on a path staying where it is.
const (
	// UIPackage is the browser application — Vite, which serves the routed
	// app.<slug> hostname and proxies /api to the backend lane.
	UIPackage = "@langwatch/ui"
	// BackendPackage is the contributor-only launcher that hosts the API
	// application and the worker application in one local process. Both
	// applications keep their own entry points; this only starts them together.
	BackendPackage = "@langwatch/dev-runtime"
	// APIPackage and WorkerPackage are the two applications the backend lane
	// hosts. Locally they share one process; in production each is its own
	// deployment, started from its own entry point. Named here because that is
	// what the lane is made of, and because `pnpm --filter <pkg> dev` still runs
	// either one on its own.
	APIPackage    = "@langwatch/platform-api"
	WorkerPackage = "@langwatch/worker"
)

// The lane names haven supervises, logs and restarts by.
const (
	// APILane is the Node process serving the API. It hosts the worker beside
	// it locally (ADR-004, amendment 2026-09-07), but it is named for what a
	// person reaches: the API, at the app's /api.
	APILane = "api"
	// LegacyAPILane is what this lane was called before it was named for the
	// application it serves. Captures written then are still on disk, so the
	// name still resolves — it is never written any more.
	LegacyAPILane = "backend"
	// WorkerLane is the worker half of that process. It is not a lane haven
	// supervises or restarts on its own — it is reported as its own row because
	// it has its own liveness, and a stack whose worker is down looks healthy
	// from every other row.
	WorkerLane = "worker"
	// AppLane is the ui and api lanes run as one process (LANGWATCH_DEV_ONE_PROCESS=1).
	// Same name as a monolith checkout's one lane, for the same reason.
	AppLane = domain.MonolithAppLane
	// GoLane is the process hosting the Go data-plane services.
	GoLane = "go"
	// SimsLane is the second Go process, hosting the simulators a stack
	// selected, so load on one cannot starve the gateway.
	SimsLane = "sims"
)

// The address variable each service in the combined Go process binds. One per
// service, because SERVER_ADDR cannot name two listeners in one process. They
// are the same names cmd/service reads.
const (
	GatewayAddrEnv = "LANGWATCH_GO_AIGATEWAY_ADDR"
	NLPAddrEnv     = "LANGWATCH_GO_NLPGO_ADDR"
	IDPAddrEnv     = "LANGWATCH_GO_IDPSIM_ADDR"
)

// The two developer tools a stack can optionally supervise, by workspace
// package name. They are tools rather than parts of the product — nothing the
// application does depends on either — so they stay in their own packages and
// haven only runs them for a worktree that asked (`haven up +design-system
// +mail-room`).
const (
	// DesignSystemPackage owns the component workshop (Storybook), routed at
	// design-system.<slug>.
	DesignSystemPackage = "@langwatch/design-system"
	// MailPackage owns the studio that previews every transactional message,
	// routed at mail-room.<slug>. Its `dev` script is the studio's Vite server.
	MailPackage = "@langwatch/mail"
)

// UIDirRel is where the browser application lives inside the workspace. Only
// the Vite lane's own working directory needs it — the HMR-gate marker is
// resolved by the plugin against that directory, not the workspace root.
const UIDirRel = "apps/ui"

// UIDir is the Vite lane's working directory inside a checkout.
func UIDir(repoDir string) string { return filepath.Join(repoDir, UIDirRel) }
