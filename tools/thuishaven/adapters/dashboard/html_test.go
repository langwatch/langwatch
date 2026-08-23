package dashboard

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "The web dashboard shows the same machine picture"
func TestRenderHTML(t *testing.T) {
	sharedURL := func(svc string) string { return "https://" + svc + ".langwatch.localhost" }

	t.Run("given no stacks", func(t *testing.T) {
		t.Run("when rendered, it explains how to start one", func(t *testing.T) {
			page := renderHTML(nil, renderInputs{sharedURL: sharedURL, probes: Probes{}, extras: Extras{}})
			if !strings.Contains(page, "haven up") {
				t.Error("empty state should tell the user how to start a stack")
			}
		})
	})

	t.Run("given a live stack with probes and the machine picture", func(t *testing.T) {
		stacks := []domain.Stack{{
			Slug:               "portless",
			Branch:             "feat/x <script>",
			WorktreeDir:        "/repos/worktrees/portless",
			LauncherPID:        4242,
			RedisDB:            3,
			ClickHouseDatabase: "lw_portless",
			UpdatedAt:          time.Now().Add(-20 * time.Second),
			Services: []domain.Service{
				{Name: "app", Hostname: "app.portless.langwatch.localhost", URL: "https://app.portless.langwatch.localhost", Port: 5560},
				{Name: "langyagent", Hostname: "langyagent.portless.langwatch.localhost", URL: "https://langyagent.portless.langwatch.localhost", Port: 0},
				{Name: "clickhouse", Hostname: "clickhouse.portless.langwatch.localhost", URL: "https://clickhouse.portless.langwatch.localhost", Port: 51748},
				{Name: "postgres", Hostname: "postgres.portless.langwatch.localhost", URL: "https://postgres.portless.langwatch.localhost", Port: 5432},
				{Name: "redis", Hostname: "redis.portless.langwatch.localhost", URL: "https://redis.portless.langwatch.localhost", Port: 6379},
			},
		}}
		probes := Probes{
			PortInUse:    func(int) bool { return true },
			ProcessAlive: func(int) bool { return true },
		}
		extras := Extras{
			Summary: SummaryView{
				TotalRAM:   32 << 30,
				StacksRSS:  4 << 30,
				ServerRSS:  map[string]uint64{"clickhouse": 1 << 30, "redis": 512 << 20},
				AgentRSS:   3 << 30,
				AgentCount: 2,
				ToolingRSS: 2 << 30,
				OtherRSS:   8 << 30,
				Pressure:   "amber",
			},
			StackRSS: map[int]uint64{4242: 4 << 30},
			Worktrees: []WorktreeView{
				{Slug: "", Branch: "main", Dir: "/repos/langwatch", IsPrimary: true},
				{Slug: "beta", Branch: "feat/beta", Dir: "/repos/worktrees/beta"},
			},
			Events: []EventView{
				{At: time.Now().Add(-2 * time.Minute), Kind: "testcontainer", Target: "tc-ryuk", Reason: "left behind by an interrupted test run"},
			},
		}

		page := renderHTML(stacks, renderInputs{sharedURL: sharedURL, probes: probes, extras: extras})

		t.Run("when rendered, the stack shows live with its databases and whole-tree footprint", func(t *testing.T) {
			for _, want := range []string{"portless", `<span class="pill live">live</span>`, "lw_portless", "~4.0GB", "app.portless.langwatch.localhost"} {
				if !strings.Contains(page, want) {
					t.Errorf("page should contain %q", want)
				}
			}
		})

		t.Run("when rendered, the machine bar and its legend cover dev and other work", func(t *testing.T) {
			for _, want := range []string{`class="bar"`, "dev work ~10.5GB", "everything else ~8.0GB", "agents ~3.0GB (2)", "pressure amber"} {
				if !strings.Contains(page, want) {
					t.Errorf("machine picture should contain %q", want)
				}
			}
		})

		t.Run("when rendered, the shared servers appear once, not on every card", func(t *testing.T) {
			if !strings.Contains(page, "Shared by every stack: clickhouse ~1.0GB") {
				t.Error("the shared strip should name the shared servers with their footprints")
			}
			if strings.Contains(page, "clickhouse.portless.langwatch.localhost") {
				t.Error("shared service rows must not repeat on the stack card")
			}
			if strings.Contains(page, "postgres.portless.langwatch.localhost") || strings.Contains(page, "redis.portless.langwatch.localhost") {
				t.Error("postgres/redis rows must not repeat on the stack card")
			}
		})

		t.Run("when rendered, a portless service shows no lying :0", func(t *testing.T) {
			if !strings.Contains(page, "langyagent.portless.langwatch.localhost") {
				t.Fatal("the stack's own langyagent row should stay")
			}
			if strings.Contains(page, ":0<") {
				t.Error("a zero port must render blank, not :0")
			}
		})

		t.Run("when rendered, the stackless worktrees and the reaping are sections", func(t *testing.T) {
			for _, want := range []string{"Worktrees", "nothing running from these", "beta", "primary, protected", "Recent reaping", "tc-ryuk", "left behind by an interrupted test run"} {
				if !strings.Contains(page, want) {
					t.Errorf("page should contain %q", want)
				}
			}
		})

		t.Run("when rendered, the aggregate stats count the stack, its own services, and dev ram", func(t *testing.T) {
			for _, want := range []string{
				`<span class="n">1<span class="of"> / 1</span></span><span class="l">stacks live</span>`,
				`<span class="l">services up</span>`,
				`<span class="l">dev ram</span>`,
				`<span class="n">2</span><span class="l">agents</span>`,
			} {
				if !strings.Contains(page, want) {
					t.Errorf("stats should contain %q", want)
				}
			}
		})

		t.Run("when rendered, branch names are HTML-escaped", func(t *testing.T) {
			// The page has its own legitimate <script> block (live refresh), so pin
			// the branch value specifically: raw absent, escaped present.
			if strings.Contains(page, "feat/x <script>") {
				t.Error("unescaped branch name reached the page")
			}
			if !strings.Contains(page, "feat/x &lt;script&gt;") {
				t.Error("branch name should be rendered HTML-escaped")
			}
		})
	})

	t.Run("given a live stack whose service port is not in use", func(t *testing.T) {
		stacks := []domain.Stack{{Slug: "booting", LauncherPID: 4242, Services: []domain.Service{{Name: "app", Port: 5560}}}}
		probes := Probes{
			ProcessAlive: func(int) bool { return true },
			PortInUse:    func(int) bool { return false },
		}
		t.Run("when rendered, the unreachable service gets a down dot", func(t *testing.T) {
			if !strings.Contains(renderHTML(stacks, renderInputs{sharedURL: sharedURL, probes: probes, extras: Extras{}}), `<span class="dot down">`) {
				t.Error("service with a free port should render a down dot")
			}
		})
	})

	t.Run("given a stack whose launcher died", func(t *testing.T) {
		stacks := []domain.Stack{{Slug: "gone", LauncherPID: 999, Services: []domain.Service{{Name: "app", Port: 1}}}}
		probes := Probes{
			ProcessAlive: func(int) bool { return false },
			PortInUse:    func(int) bool { return false },
		}
		t.Run("when rendered, it shows stale", func(t *testing.T) {
			page := renderHTML(stacks, renderInputs{sharedURL: sharedURL, probes: probes, extras: Extras{}})
			if !strings.Contains(page, `<span class="pill stale">stale</span>`) {
				t.Error("dead launcher should render a stale pill")
			}
			if strings.Contains(page, `<span class="pill live">live</span>`) {
				t.Error("dead launcher must not render a live pill")
			}
		})
	})
}
