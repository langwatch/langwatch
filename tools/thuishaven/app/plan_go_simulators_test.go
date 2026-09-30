package app

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// simulatorCheckout is a checkout whose dev build links the simulators.
func simulatorCheckout(t *testing.T) string {
	repo := t.TempDir()
	marker := filepath.Join(repo, SimulatorsInGoFile)
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("//go:build dev\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return repo
}

func simulatorStack(repo string, layout domain.Layout) domain.Stack {
	return domain.Stack{Slug: "test", WorktreeDir: repo, Layout: layout, Services: []domain.Service{
		{Name: "gateway", Port: 44003},
		{Name: "nlp", Port: 44001},
		{Name: "idp", Port: 45570, DNSPort: 45571, URL: "https://idp.test.langwatch.localhost"},
		{Name: "mail", Port: 45580, SMTPPort: 45581, URL: "https://mail.test.langwatch.localhost"},
		{Name: "storage", Port: 45590, URL: "https://storage.test.langwatch.localhost"},
		{Name: "voice", Port: 45591},
		{Name: "llm", Port: 45595},
		{Name: "app", Port: 45560, URL: "https://app.test.langwatch.localhost"},
	}}
}

// everySimulator selects all five simulators beside the data plane.
func everySimulator() domain.Selection {
	sel := domain.DefaultSelection()
	sel.IDP, sel.Mail, sel.Storage, sel.Voice, sel.LLM = true, true, true, true, true
	return sel
}

var simulatorLanes = []string{"idp", "mail", "storage", "voice", "llm"}

// @scenario "A dev checkout's go lane hosts the simulators"
func TestTheGoLaneHostsTheSimulatorsInADevCheckout(t *testing.T) {
	home := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: home, SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	repo := simulatorCheckout(t)
	children := o.planChildren(simulatorStack(repo, domain.LayoutModular),
		PlanOptions{Selection: everySimulator(), RepoRoot: repo}, repo, "")

	for _, name := range simulatorLanes {
		if _, ok := findChild(children, name); ok {
			t.Errorf("%s is still its own lane; the go lane hosts it", name)
		}
	}
	lane, ok := findChild(children, GoLane)
	if !ok {
		t.Fatal("no go lane was planned")
	}
	if !strings.Contains(lane.Shell, `args="aigateway nlpgo idpsim mailsim storagesim voicesim llmsim"`) {
		t.Errorf("go lane runs %q, want it to host both simulators", lane.Shell)
	}
	want := map[string]string{
		IDPAddrEnv:                ":45570",
		"IDPSIM_BASE_URL":         "https://idp.test.langwatch.localhost",
		"IDPSIM_DNS_ADDR":         "127.0.0.1:45571",
		"IDPSIM_DATA_DIR":         filepath.Join(home, "idp", "test"),
		"MAILSIM_HTTP_ADDR":       ":45580",
		"MAILSIM_SMTP_ADDR":       ":45581",
		"MAILSIM_BASE_URL":        "https://mail.test.langwatch.localhost",
		"MAILSIM_DATA_DIR":        filepath.Join(home, "mail", "test"),
		"STORAGESIM_ADDR":         ":45590",
		"STORAGESIM_DATA_DIR":     filepath.Join(home, "storage", "test"),
		"STORAGESIM_CORS_ORIGINS": "https://app.test.langwatch.localhost",
		"VOICESIM_ADDR":           ":45591",
		"LLMSIM_ADDR":             ":45595",
		"LLMSIM_STACK":            "test",
	}
	for key, value := range want {
		if got := valueOf(lane.Env, key); got != value {
			t.Errorf("go lane %s = %q, want %q", key, got, value)
		}
	}
	if valueOf(lane.Env, "SERVER_ADDR") != "" {
		t.Error("the go lane carries SERVER_ADDR; one process cannot bind it for several listeners")
	}
}

// A monolith checkout's mono-binary has no combined process to host them.
//
// @scenario "Simulator lanes run Haven's bundled code in a checkout that does not link them"
func TestAMonolithKeepsTheBundledSimulatorLanes(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	repo := simulatorCheckout(t)
	children := o.planChildren(simulatorStack(repo, domain.LayoutMonolith),
		PlanOptions{Selection: everySimulator(), RepoRoot: repo}, repo, "")
	for _, name := range simulatorLanes {
		child, ok := findChild(children, name)
		if !ok || !strings.Contains(child.Shell, "'simulator'") {
			t.Errorf("monolith %s lane = %+v, want Haven's bundled simulator", name, child)
		}
	}
}

// @scenario "The Go data-plane services are restarted as one lane"
func TestTheSimulatorsRestartWithTheGoLaneTheyShare(t *testing.T) {
	names := func(st domain.Stack) []string {
		var out []string
		for _, target := range restartTargets(st, "") {
			out = append(out, target.Name)
		}
		return out
	}
	hosted := names(simulatorStack(simulatorCheckout(t), domain.LayoutModular))
	bundled := names(simulatorStack(t.TempDir(), domain.LayoutModular))
	for _, sim := range simulatorLanes {
		if slices.Contains(hosted, sim) || !slices.Contains(bundled, sim) {
			t.Errorf("%s: restartable %v where the go lane hosts it, %v where Haven bundles it", sim, hosted, bundled)
		}
	}
	if !slices.Contains(hosted, GoLane) {
		t.Errorf("restartable = %v, want the go lane", hosted)
	}
}
