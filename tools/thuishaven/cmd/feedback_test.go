package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
)

type orbRun struct {
	store  orbstore.Store
	args   []string
	flags  map[string]string
	asJSON bool
}

func (r orbRun) feedback(t *testing.T) string {
	t.Helper()
	var out bytes.Buffer
	c := orbCLI{store: r.store, inv: invocation{args: r.args, flags: r.flags}, asJSON: r.asJSON, out: &out}
	if err := feedbackCommand(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func (r orbRun) page(t *testing.T) string {
	t.Helper()
	var out bytes.Buffer
	c := orbCLI{store: r.store, inv: invocation{args: r.args, flags: r.flags}, asJSON: r.asJSON, out: &out}
	if err := pageCommand(c); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

// @scenario "an agent lists open feedback"
func TestFeedbackListOpenAnswersTheOpenItemAlone(t *testing.T) {
	store := orbstore.At(t.TempDir())
	open, _ := store.Add(orbstore.Report{Note: "chart legend clipped"}, time.Unix(1, 0))
	done, _ := store.Add(orbstore.Report{Note: "fixed already"}, time.Unix(2, 0))
	if _, err := store.Resolve(done.ID, time.Unix(3, 0)); err != nil {
		t.Fatal(err)
	}
	out := orbRun{store: store, args: []string{"list"}, flags: map[string]string{"--open": ""}, asJSON: true}.feedback(t)
	var got struct {
		Feedback []orbstore.Feedback `json:"feedback"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Feedback) != 1 || got.Feedback[0].ID != open.ID {
		t.Fatalf("got %+v", got.Feedback)
	}
}

// @scenario "an agent waits for new feedback"
func TestFeedbackWaitReturnsTheItemThatArrives(t *testing.T) {
	store := orbstore.At(t.TempDir())
	go func() {
		time.Sleep(100 * time.Millisecond)
		_, _ = store.Add(orbstore.Report{Note: "arrived while waiting"}, time.Now())
	}()
	out := orbRun{store: store, args: []string{"wait"}, flags: map[string]string{"--timeout": "5s"}}.feedback(t)
	if !strings.Contains(out, "arrived while waiting") {
		t.Fatalf("output %q", out)
	}
}

func orbPageStore(t *testing.T) orbstore.Store {
	t.Helper()
	store := orbstore.At(t.TempDir())
	err := store.SavePage(orbstore.Page{
		URL:     "https://app.feat-x.langwatch.localhost:1355/p",
		Console: []orbstore.ConsoleEntry{{Level: "error", Text: "boom"}, {Level: "log", Text: "hello"}},
		Network: []orbstore.Request{{Method: "GET", URL: "/ok", Status: 200}, {Method: "POST", URL: "/bad", Status: 500, Failed: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

// @scenario "an agent reads the page's console errors"
func TestPageConsoleKeepsTheLevelAsked(t *testing.T) {
	out := orbRun{store: orbPageStore(t), args: []string{"console"}, flags: map[string]string{"--level": "error"}, asJSON: true}.page(t)
	if !strings.Contains(out, "boom") || strings.Contains(out, "hello") {
		t.Fatalf("output %q", out)
	}
}

// @scenario "an agent reads the page's failed requests"
func TestPageNetworkFailedKeepsFailuresAlone(t *testing.T) {
	out := orbRun{store: orbPageStore(t), args: []string{"network"}, flags: map[string]string{"--failed": ""}, asJSON: true}.page(t)
	if !strings.Contains(out, `"/bad"`) || strings.Contains(out, `"/ok"`) {
		t.Fatalf("output %q", out)
	}
}
