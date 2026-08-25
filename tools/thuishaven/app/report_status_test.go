package app

import (
	"encoding/json"
	"io"
	"os"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// captureStdout runs fn with os.Stdout redirected and returns what it printed.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	fn()
	os.Stdout = saved
	_ = w.Close()
	out := <-done
	_ = r.Close()
	return out
}

func statusOrch(store *fakeStore, sys *fakeSystem) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{}, log: zap.NewNop(),
	}
}

// statusJSON is the shape a script reads: only the fields these tests assert on.
type statusJSON struct {
	Stacks *[]struct {
		Slug     string `json:"slug"`
		Live     bool   `json:"live"`
		Services []struct {
			Name      string `json:"name"`
			Listening bool   `json:"listening"`
		} `json:"services"`
	} `json:"stacks"`
}

func decodeStatus(t *testing.T, out string) statusJSON {
	t.Helper()
	var got statusJSON
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("status --json is not valid JSON: %v\n%s", err, out)
	}
	if got.Stacks == nil {
		t.Fatal("stacks was null: a script cannot tell 'no stack registered' from a missing field")
	}
	return got
}

// The incident read `stacks: null` as "no stack is registered". Both states are
// real and they need different answers, so the report has to state each one.
// @scenario "Status separates no stack from a dead stack"
func TestStatusJSONSeparatesNoStackFromADeadStack(t *testing.T) {
	t.Run("given no stack is registered", func(t *testing.T) {
		t.Run("when status runs as JSON, stacks is an empty list", func(t *testing.T) {
			o := statusOrch(&fakeStore{}, &fakeSystem{})

			out := captureStdout(t, func() {
				if err := o.Status(true, ""); err != nil {
					t.Fatalf("status: %v", err)
				}
			})

			if got := decodeStatus(t, out); len(*got.Stacks) != 0 {
				t.Errorf("stacks = %v, want an empty list", *got.Stacks)
			}
		})
	})

	t.Run("given a registered stack whose launcher is gone", func(t *testing.T) {
		t.Run("when status runs as JSON, the stack is listed and marked dead", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{droppedStack(42)}}
			o := statusOrch(store, &fakeSystem{alive: map[int]bool{42: false}})

			out := captureStdout(t, func() {
				if err := o.Status(true, ""); err != nil {
					t.Fatalf("status: %v", err)
				}
			})

			got := decodeStatus(t, out)
			if len(*got.Stacks) != 1 {
				t.Fatalf("stacks = %v, want the registered stack listed", *got.Stacks)
			}
			st := (*got.Stacks)[0]
			if st.Slug != "feat-x" || st.Live {
				t.Errorf("stack = %+v, want feat-x reported as not live", st)
			}
			if len(st.Services) != 1 || st.Services[0].Listening {
				t.Errorf("services = %+v, want app reported as not listening", st.Services)
			}
		})
	})

	t.Run("given a registered stack whose launcher is running", func(t *testing.T) {
		t.Run("when status runs as JSON, the stack and its listening ports are live", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{droppedStack(42)}}
			sys := &fakeSystem{alive: map[int]bool{42: true}, portsInUse: map[int]bool{9000: true}}
			o := statusOrch(store, sys)

			out := captureStdout(t, func() {
				if err := o.Status(true, ""); err != nil {
					t.Fatalf("status: %v", err)
				}
			})

			st := (*decodeStatus(t, out).Stacks)[0]
			if !st.Live || len(st.Services) != 1 || !st.Services[0].Listening {
				t.Errorf("stack = %+v, want it live with app listening", st)
			}
		})
	})
}
