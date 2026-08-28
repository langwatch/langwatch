package fileregistry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func writeSelectionJSON(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, ".haven.json"), []byte(body), 0o644); err != nil {
		t.Fatalf("write .haven.json: %v", err)
	}
}

// .haven.json is a file in the developer's worktree, so it gets hand-edited,
// hand-merged and truncated. Decoded straight into a Selection, every key it
// does not mention reads as false — so a file naming only the service someone
// turned on silently takes gateway and nlp off the stack, and the developer's
// next `haven up` runs an app with no NLP engine and no gateway for no stated
// reason.
//
// @scenario "A selection file that names only some services keeps the defaults for the rest"
func TestReadSelectionKeepsDefaultsForServicesTheFileNeverNames(t *testing.T) {
	s := New(t.TempDir())

	t.Run("given a file that states only the service it turns on", func(t *testing.T) {
		dir := t.TempDir()
		writeSelectionJSON(t, dir, `{"services":{"langy":true}}`)

		t.Run("when the selection is read", func(t *testing.T) {
			sel, ok := s.ReadSelection(dir)
			if !ok {
				t.Fatal("a file stating a service was treated as never written")
			}
			if !sel.Langy {
				t.Error("langy is off; the one thing the file states was ignored")
			}
			def := domain.DefaultSelection()
			if sel.Gateway != def.Gateway || sel.NLP != def.NLP {
				t.Errorf("gateway=%v nlp=%v, want the defaults %v/%v — an unnamed service is not a disabled one",
					sel.Gateway, sel.NLP, def.Gateway, def.NLP)
			}
		})
	})

	t.Run("given a file that turns a defaulted-on service off", func(t *testing.T) {
		dir := t.TempDir()
		writeSelectionJSON(t, dir, `{"services":{"nlp":false}}`)

		t.Run("when the selection is read", func(t *testing.T) {
			sel, ok := s.ReadSelection(dir)
			if !ok {
				t.Fatal("a file stating a service was treated as never written")
			}
			// Stated false has to survive, or "keep the defaults" would quietly
			// become "you may never turn anything off".
			if sel.NLP {
				t.Error("nlp is on; the file says false and stated beats default")
			}
			if !sel.Gateway {
				t.Error("gateway lost its default because a sibling key was stated")
			}
		})
	})

	t.Run("given a file that states no services at all", func(t *testing.T) {
		for name, body := range map[string]string{
			"empty object":        `{}`,
			"null services":       `{"services":null}`,
			"unrelated keys only": `{"note":"scratch"}`,
		} {
			t.Run("when the selection is read from "+name, func(t *testing.T) {
				dir := t.TempDir()
				writeSelectionJSON(t, dir, body)
				if _, ok := s.ReadSelection(dir); ok {
					t.Error("a file naming no service reported a selection; the caller must fall back to the default")
				}
			})
		}
	})

	t.Run("given no file at all", func(t *testing.T) {
		t.Run("when the selection is read", func(t *testing.T) {
			if _, ok := s.ReadSelection(t.TempDir()); ok {
				t.Error("a worktree that never chose reported a selection")
			}
		})
	})

	t.Run("given a half-written file", func(t *testing.T) {
		dir := t.TempDir()
		writeSelectionJSON(t, dir, `{"services":{"gateway":tr`)

		t.Run("when the selection is read", func(t *testing.T) {
			if _, ok := s.ReadSelection(dir); ok {
				t.Error("unparseable JSON reported a selection")
			}
		})
	})
}

// The read side keeps defaults for what a file does not state; the write side
// must never lean on that, or a service haven itself turned off would come back
// on the next read.
func TestWriteSelectionStatesEveryService(t *testing.T) {
	s := New(t.TempDir())

	t.Run("given a selection with everything off", func(t *testing.T) {
		dir := t.TempDir()
		off := domain.Selection{}

		t.Run("when it is written and read back", func(t *testing.T) {
			if err := s.WriteSelection(dir, off); err != nil {
				t.Fatalf("WriteSelection: %v", err)
			}

			b, err := os.ReadFile(filepath.Join(dir, ".haven.json"))
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			var raw struct {
				Services map[string]any `json:"services"`
			}
			if err := json.Unmarshal(b, &raw); err != nil {
				t.Fatalf("written file is not valid JSON: %v", err)
			}
			for _, svc := range domain.SelectableServices {
				if _, stated := raw.Services[svc]; !stated {
					t.Errorf("written file omits %q, so reading it back would restore its default", svc)
				}
			}

			got, ok := s.ReadSelection(dir)
			if !ok {
				t.Fatal("a written selection read back as never written")
			}
			if got != off {
				t.Errorf("read back %+v, want %+v — a round trip must not change the stack", got, off)
			}
		})
	})

	t.Run("given a selection with everything on", func(t *testing.T) {
		dir := t.TempDir()
		on := domain.Selection{Workers: true, Gateway: true, NLP: true, Langy: true}

		t.Run("when it is written and read back", func(t *testing.T) {
			if err := s.WriteSelection(dir, on); err != nil {
				t.Fatalf("WriteSelection: %v", err)
			}
			got, ok := s.ReadSelection(dir)
			if !ok {
				t.Fatal("a written selection read back as never written")
			}
			if got != on {
				t.Errorf("read back %+v, want %+v", got, on)
			}
		})
	})
}

// The durations file holds every command's estimate in one map, and each
// writer publishes the whole map. Without a lock across the read and the
// write, two runs finishing together each write a map built before the other's
// update, and the later writer drops the earlier one's key — which reads back
// as a command nobody has ever timed.
//
// @scenario "Timings survive several runs finishing at once"
func TestObserveDurationKeepsEveryKeyWhenRunsFinishTogether(t *testing.T) {
	t.Run("given many runs recording different commands at the same moment", func(t *testing.T) {
		store := New(t.TempDir())
		keys := []string{"unit", "integration", "typecheck", "lint", "oxlint", "tsgo"}

		var wg sync.WaitGroup
		for _, key := range keys {
			wg.Add(1)
			go func() {
				defer wg.Done()
				store.ObserveDuration(key, 30*time.Second)
			}()
		}
		wg.Wait()

		t.Run("every one of them is still there afterwards", func(t *testing.T) {
			for _, key := range keys {
				if store.ObservedDuration(key) == 0 {
					t.Fatalf("%q was overwritten by another writer, so it reads as never observed", key)
				}
			}
		})
	})
}

// @scenario "Reaping is recorded as it happens"
func TestReapEventsPersistBoundedNewestLast(t *testing.T) {
	s := New(t.TempDir())

	if got := s.ReapEvents(); len(got) != 0 {
		t.Fatalf("an absent record must read empty, got %d events", len(got))
	}
	for i := range domain.ReapEventCap + 5 {
		ev := domain.ReapEvent{At: time.Unix(int64(i), 0), Kind: "testcontainer", Target: "tc-ryuk", Reason: "leaked"}
		if err := s.AppendReapEvent(ev); err != nil {
			t.Fatalf("append: %v", err)
		}
	}

	events := s.ReapEvents()
	if len(events) != domain.ReapEventCap {
		t.Fatalf("record must cap at %d, got %d", domain.ReapEventCap, len(events))
	}
	if !events[len(events)-1].At.Equal(time.Unix(int64(domain.ReapEventCap+4), 0)) {
		t.Fatal("the newest event must survive the cap, oldest dropped")
	}
	if events[0].At.Equal(time.Unix(0, 0)) {
		t.Fatal("the oldest event past the cap must be dropped")
	}
}
