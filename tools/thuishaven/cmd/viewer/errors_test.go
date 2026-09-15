package viewer

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

func errorsTab(t *testing.T) *ErrorsTab {
	t.Helper()
	return NewErrorsTab(Sources{Now: time.Now})
}

// @scenario "Errors are grouped by signature"
func TestErrorsAreGroupedBySignature(t *testing.T) {
	tab := errorsTab(t)
	base := time.Now().Add(-11 * time.Minute)
	for i := 0; i < 11; i++ {
		tab.Observe(sources.LogLine{
			At:   base.Add(time.Duration(i) * time.Minute),
			Lane: "backend",
			Text: `{"name":"langwatch:api","level":"error","msg":"RepositoryOwnershipConflictError: project ` +
				itoa(1000+i) + ` is owned by another writer","stack":"at repo.ts:` + itoa(10+i) + `"}`,
		})
	}

	groups := tab.Groups()
	if len(groups) != 1 {
		t.Fatalf("groups = %d, want the eleven restarts folded into one", len(groups))
	}
	if groups[0].Count != 11 {
		t.Errorf("count = %d, want 11", groups[0].Count)
	}
	if !groups[0].FirstSeen.Equal(base) {
		t.Errorf("first seen = %s, want the first of the eleven (%s)", groups[0].FirstSeen, base)
	}
	if !groups[0].LastSeen.After(groups[0].FirstSeen) {
		t.Error("last seen must be the most recent occurrence, not the first")
	}
	if groups[0].App != "api" {
		t.Errorf("lane = %q, want the application the line came from", groups[0].App)
	}

	t.Run("when the developer presses enter", func(t *testing.T) {
		if !tab.Key("enter") {
			t.Fatal("enter was not claimed by the errors tab")
		}
		detail := strings.Join(tab.Detail(), "\n")
		if !strings.Contains(detail, "project 1010") {
			t.Errorf("detail = %q, want the LAST occurrence's own message", detail)
		}
		if !strings.Contains(detail, "at repo.ts:20") {
			t.Errorf("detail = %q, want the last occurrence's stack", detail)
		}
	})

	t.Run("when the developer presses esc", func(t *testing.T) {
		if !tab.Key("esc") {
			t.Fatal("esc was not claimed while a group was open")
		}
		if tab.Open() != "" {
			t.Errorf("open = %q, want esc to return to the list", tab.Open())
		}
	})
}

// @scenario "Errors are ordered by last seen"
func TestErrorsAreOrderedByLastSeen(t *testing.T) {
	tab := errorsTab(t)
	old := time.Now().Add(-10 * time.Minute)
	tab.Observe(sources.LogLine{At: old, Lane: "go", Text: `{"level":"error","msg":"the older failure"}`})
	tab.Observe(sources.LogLine{At: time.Now(), Lane: "ui", Text: `{"level":"error","msg":"the newer failure"}`})

	groups := tab.Groups()
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want two distinct failures", len(groups))
	}
	if !strings.Contains(groups[0].Message, "newer") {
		t.Errorf("top row = %q, want the most recently seen failure on top", groups[0].Message)
	}
}

// The grouping rule itself, apart from the tab: the platform's own signature
// wins where a line carries one, so this screen and Grafana agree about what
// "the same error" means.
func TestSignatureRule(t *testing.T) {
	cases := []struct {
		name    string
		text    string
		message string
		want    string
	}{
		{
			name:    "a stamped signature is the key",
			text:    `{"errorSignature":"repo_ownership_conflict","msg":"whatever the prose says"}`,
			message: "whatever the prose says",
			want:    "repo_ownership_conflict",
		},
		{
			name:    "ids and digits are removed from a bare message",
			message: `insert into project_2f8Kd91mQ0xZa failed after 1423ms`,
			want:    "insert into * failed after *ms",
		},
		{
			name:    "an interpolated value is collapsed",
			message: `no capture for "gateway"`,
			want:    `no capture for ""`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Signature(tc.text, tc.message); got != tc.want {
				t.Errorf("Signature = %q, want %q", got, tc.want)
			}
		})
	}
}
