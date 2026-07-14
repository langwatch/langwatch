package dashboard

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestRenderHTML(t *testing.T) {
	sharedURL := func(svc string) string { return "https://" + svc + ".langwatch.localhost" }

	t.Run("given no stacks", func(t *testing.T) {
		t.Run("when rendered, it explains how to start one", func(t *testing.T) {
			page := renderHTML(nil, sharedURL, Probes{})
			if !strings.Contains(page, "pnpm dev") {
				t.Error("empty state should tell the user how to start a stack")
			}
		})
	})

	t.Run("given a live stack with probes", func(t *testing.T) {
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
			},
		}}
		probes := Probes{
			PortInUse:    func(int) bool { return true },
			ProcessAlive: func(int) bool { return true },
			GroupRSS:     func(int) uint64 { return 512 * 1024 * 1024 },
			TotalMemory:  func() uint64 { return 32 * 1024 * 1024 * 1024 },
		}

		page := renderHTML(stacks, sharedURL, probes)

		t.Run("when rendered, the stack shows live with its databases and footprint", func(t *testing.T) {
			for _, want := range []string{"portless", `<span class="pill live">live</span>`, "lw_portless", "512.0MB", "32.0GB", "app.portless.langwatch.localhost"} {
				if !strings.Contains(page, want) {
					t.Errorf("page should contain %q", want)
				}
			}
		})

		t.Run("when rendered, the reachable service gets an up dot", func(t *testing.T) {
			if !strings.Contains(page, `<span class="dot up">`) {
				t.Error("service with its port in use should render an up dot")
			}
		})

		t.Run("when rendered, the aggregate stats count the stack, its service, and its databases", func(t *testing.T) {
			for _, want := range []string{
				`<span class="n">1<span class="of"> / 1</span></span><span class="l">stacks live</span>`,
				`<span class="n">1<span class="of"> / 1</span></span><span class="l">services up</span>`,
				`<span class="n">512.0MB<span class="of"> / 32.0GB</span></span><span class="l">stack ram</span>`,
				`<span class="n">2</span><span class="l">databases</span>`,
			} {
				if !strings.Contains(page, want) {
					t.Errorf("stats should contain %q", want)
				}
			}
		})

		t.Run("when rendered, branch names are HTML-escaped", func(t *testing.T) {
			if strings.Contains(page, "<script>") {
				t.Error("unescaped branch name reached the page")
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
			if !strings.Contains(renderHTML(stacks, sharedURL, probes), `<span class="dot down">`) {
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
			page := renderHTML(stacks, sharedURL, probes)
			if !strings.Contains(page, `<span class="pill stale">stale</span>`) {
				t.Error("dead launcher should render a stale pill")
			}
			if strings.Contains(page, `<span class="pill live">live</span>`) {
				t.Error("dead launcher must not render a live pill")
			}
		})
	})
}
