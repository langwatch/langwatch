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

// @scenario "Errors distinguish services and expose the underlying cause"
func TestErrorServiceAndCause(t *testing.T) {
	tab := errorsTab(t)
	at := time.Now()
	for _, lane := range []string{"api", "worker"} {
		tab.Observe(sources.LogLine{At: at, Lane: lane, Text: `{"level":"error","msg":"tRPC call failed","error":{"type":"TRPCError","message":"Project API is unavailable"},"path":"project.list"}`})
	}
	if groups := tab.Groups(); len(groups) != 2 || groups[0].Count != 1 {
		t.Fatalf("services merged: %#v", groups)
	}
	frame := Frame{Width: 100, Height: 6}
	body := strings.Join(texts(tab.Body(frame)), "\n")
	if !strings.Contains(body, "Project API is unavailable") || !strings.Contains(body, "api") || !strings.Contains(body, "worker") {
		t.Fatal(body)
	}
	tab.Key("enter")
	detail := strings.Join(tab.Detail(), "\n")
	if !strings.Contains(detail, "CAUSE") || !strings.Contains(detail, "project.list") {
		t.Fatal(detail)
	}
}

// @scenario "Error selection survives refresh and long details scroll from the top"
func TestErrorsKeepSelectionAndScrollDetails(t *testing.T) {
	tab := errorsTab(t)
	now := time.Now()
	for i, message := range []string{"older failure", "selected failure", "newer failure"} {
		tab.Observe(sources.LogLine{At: now.Add(time.Duration(i) * time.Second), Lane: "api", Text: `{"level":"error","msg":"` + message + `","stack":"` + strings.Repeat("frame\\n", 35) + `last frame"}`})
	}
	frame := Frame{Width: 80, Height: 6}
	tab.Body(frame)
	tab.Key("down")
	tab.Observe(sources.LogLine{At: now.Add(4 * time.Second), Lane: "api", Text: `{"level":"error","msg":"another failure"}`})
	tab.Body(frame)
	tab.Key("enter")
	first := strings.Join(texts(tab.Body(frame)), "\n")
	if !strings.Contains(first, "selected failure") || strings.Contains(first, "last frame") {
		t.Fatal(first)
	}
	tab.Key("G")
	if last := strings.Join(texts(tab.Body(frame)), "\n"); !strings.Contains(last, "last frame") {
		t.Fatal(last)
	}
	tab.Key("esc")
	body := strings.Join(texts(tab.Body(Frame{Width: 80, Height: 3})), "\n")
	if !strings.Contains(body, "selected failure") {
		t.Fatalf("selected error is off screen: %s", body)
	}
}
