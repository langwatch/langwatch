package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// planGoLanes plans a dev checkout selecting the data plane, every simulator
// and Langy, with the one-process Go toggle as given.
func planGoLanes(t *testing.T, isOneProcess bool) []Child {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	repo := simulatorCheckout(t)
	st := simulatorStack(repo, domain.LayoutModular)
	st.Services = append(st.Services, domain.Service{Name: "langyagent", Port: 45610})
	sel := everySimulator()
	sel.Langy = true
	return o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo, ShouldRunGoAsOneProcess: isOneProcess}, repo)
}

// @scenario "One Go process hosts the data plane and the simulators when asked"
func TestOneGoProcessHostsTheDataPlaneAndTheSimulators(t *testing.T) {
	t.Run("when LANGWATCH_GO_ONE_PROCESS is on", func(t *testing.T) {
		children := planGoLanes(t, true)
		goLane, ok := findChild(children, GoLane)
		if !ok {
			t.Fatal("no go lane was planned")
		}
		if !strings.Contains(goLane.Shell, `args="aigateway nlpgo idpsim mailsim storagesim voicesim llmsim analyticssim outboundsim telemetrysim"`) {
			t.Errorf("go lane runs %q, want the data plane and every simulator", goLane.Shell)
		}
		if _, ok := findChild(children, SimsLane); ok {
			t.Error("a sims lane was planned; the go lane hosts the simulators")
		}
		for key, value := range map[string]string{
			GatewayAddrEnv:      ":44003",
			NLPAddrEnv:          ":44001",
			IDPAddrEnv:          ":45570",
			"MAILSIM_HTTP_ADDR": ":45580",
			"STORAGESIM_ADDR":   ":45590",
			"VOICESIM_ADDR":     ":45591",
			"LLMSIM_ADDR":       ":45595",
			"ANALYTICSSIM_ADDR": ":45596",
			"OUTBOUNDSIM_ADDR":  ":45598",
			"TELEMETRYSIM_ADDR": ":45597",
		} {
			if got := valueOf(goLane.Env, key); got != value {
				t.Errorf("go lane %s = %q, want %q", key, got, value)
			}
		}
		if valueOf(goLane.Env, "SERVER_ADDR") != "" {
			t.Error("the go lane carries SERVER_ADDR; one process cannot bind it for several listeners")
		}
		if lane := domain.LaneEnv(SimsLane); strings.Contains(strings.Join(goLane.Env, "\n"), lane) {
			t.Errorf("the go lane carries %s; it names itself go", lane)
		}
	})

	t.Run("when it is off", func(t *testing.T) {
		children := planGoLanes(t, false)
		goLane, ok := findChild(children, GoLane)
		if !ok || !strings.Contains(goLane.Shell, `args="aigateway nlpgo"`) {
			t.Errorf("go lane = %+v, want only the gateway and nlp", goLane)
		}
		if _, ok := findChild(children, SimsLane); !ok {
			t.Error("no sims lane was planned; the split is the default")
		}
	})

	for _, isOneProcess := range []bool{true, false} {
		children := planGoLanes(t, isOneProcess)
		if _, ok := findChild(children, "langyagent"); !ok {
			t.Errorf("one process %v: Langy has no lane of its own", isOneProcess)
		}
		for _, child := range children {
			if (child.Name == GoLane || child.Name == SimsLane) && strings.Contains(child.Shell, "langy") {
				t.Errorf("one process %v: the %s lane hosts Langy: %q", isOneProcess, child.Name, child.Shell)
			}
		}
	}
}

// @scenario "One Go process retires the sims log a split run left behind"
func TestOneGoProcessRetiresTheStaleSimsCapture(t *testing.T) {
	writeCapture := func(t *testing.T, dir string) string {
		t.Helper()
		path := filepath.Join(dir, SimsLane+".log")
		if err := os.WriteFile(path, []byte("an earlier split run\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	t.Run("when the go lane hosts the simulators, the old sims.log goes", func(t *testing.T) {
		dir := t.TempDir()
		path := writeCapture(t, dir)
		retireStaleSimsCapture([]Child{{Name: GoLane, LogPath: filepath.Join(dir, GoLane+".log")}})
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("sims.log survived (stat err %v); haven logs <sim> would read it", err)
		}
	})
	t.Run("when a sims lane runs, its capture stays", func(t *testing.T) {
		dir := t.TempDir()
		path := writeCapture(t, dir)
		retireStaleSimsCapture([]Child{
			{Name: GoLane, LogPath: filepath.Join(dir, GoLane+".log")},
			{Name: SimsLane, LogPath: path},
		})
		if _, err := os.Stat(path); err != nil {
			t.Errorf("the live sims lane's capture was removed: %v", err)
		}
	})
}
