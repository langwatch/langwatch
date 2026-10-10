package visualdiff

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

// pinFake answers `git rev-parse` with head and `git diff --shortstat` with
// shortstat, or fails the diff when the pinned commit is gone.
type pinFake struct {
	head      string
	shortstat string
	gone      bool
}

func (fake *pinFake) run(_ context.Context, spec commandSpec, log io.Writer) error {
	switch {
	case spec.name == "git" && spec.args[0] == "rev-parse":
		_, err := io.WriteString(log, fake.head+"\n")
		return err
	case spec.name == "git" && spec.args[0] == "diff" && fake.gone:
		return errors.New("bad object")
	case spec.name == "git" && spec.args[0] == "diff":
		_, err := io.WriteString(log, fake.shortstat)
		return err
	}
	return nil
}

const (
	pinnedCommit = "1111111111111111111111111111111111111111"
	mainNow      = "2222222222222222222222222222222222222222"
)

// @scenario "The base is main pinned at a commit, and the pin moves only when main moved far or is asked to"
func TestTheBaseIsMainPinnedAndThePinMovesOnlyWhenMainMovedFar(t *testing.T) {
	pinned := MainPin{Ref: "origin/main", Commit: pinnedCommit}
	cases := []struct {
		name      string
		pin       MainPin
		fake      pinFake
		rebase    bool
		wantPin   string
		wantMoved bool
		why       string
	}{
		{"no pin yet", MainPin{}, pinFake{head: mainNow}, false, mainNow, true, "no pin yet"},
		{"main changed under 2000 lines", pinned, pinFake{head: mainNow, shortstat: " 40 files changed, 1200 insertions(+), 799 deletions(-)\n"}, false, pinnedCommit, false, "1999 lines"},
		{"main changed 2000 lines", pinned, pinFake{head: mainNow, shortstat: " 40 files changed, 1200 insertions(+), 800 deletions(-)\n"}, false, mainNow, true, "2000 lines"},
		{"asked to move", pinned, pinFake{head: mainNow, shortstat: " 1 file changed, 1 insertion(+)\n"}, true, mainNow, true, "-rebase-main"},
		{"the pinned commit is gone", pinned, pinFake{head: mainNow, gone: true}, false, mainNow, true, "gone"},
		{"main has not moved", pinned, pinFake{head: pinnedCommit}, false, pinnedCommit, false, "not moved"},
	}
	for _, each := range cases {
		t.Run(each.name, func(t *testing.T) {
			fake := each.fake
			decision, err := DecidePin(context.Background(), pinRequest{run: fake.run, root: "/r", ref: "origin/main", rebase: each.rebase}, each.pin)
			if err != nil {
				t.Fatal(err)
			}
			if decision.Commit != each.wantPin || decision.Moved != each.wantMoved || !strings.Contains(decision.Why, each.why) {
				t.Fatalf("got %+v, want commit %s moved=%t why containing %q", decision, each.wantPin, each.wantMoved, each.why)
			}
		})
	}

	t.Run("a run renders the pinned commit, says why, and records a moved pin in the baseline cache", func(t *testing.T) {
		options := testOptions(t)
		options.PinMain, options.DryRun = true, false
		if err := WriteMainPin(options.Root, pinned); err != nil {
			t.Fatal(err)
		}
		fake := &pinFake{head: mainNow, shortstat: " 3 files changed, 10 insertions(+)\n"}
		deps := passingDeps(&fakeRunner{}, nil, nil)
		deps.Run = fake.run
		var stderr bytes.Buffer
		result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: &stderr})
		if err != nil {
			t.Fatal(err)
		}
		if result.Plan.Base.Ref != pinnedCommit {
			t.Fatalf("the base rendered %s, want the pin %s", result.Plan.Base.Ref, pinnedCommit)
		}
		if !strings.Contains(stderr.String(), "main: origin/main pinned at 111111111111 (origin/main changed 10 lines since the pin, under 2000)") {
			t.Fatalf("the run does not say which pin it used and why:\n%s", stderr.String())
		}

		options.RebaseMain = true
		if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard}); err != nil {
			t.Fatal(err)
		}
		if got := ReadMainPin(options.Root); got.Commit != mainNow {
			t.Fatalf("-rebase-main left the pin at %s", got.Commit)
		}
	})
}

func TestShortstatLinesSumsInsertionsAndDeletions(t *testing.T) {
	if got := ShortstatLines(" 2 files changed, 1 insertion(+), 3 deletions(-)\n"); got != 4 {
		t.Fatalf("got %d", got)
	}
	if got := ShortstatLines(""); got != 0 {
		t.Fatalf("an empty diff changed %d lines", got)
	}
}
