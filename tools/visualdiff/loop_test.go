package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "visualdiff flow re-runs one flow against a kept candidate stack in seconds"
func TestTheFixLoopKeepsItsStackAndReusesItOnTheNextCall(t *testing.T) {
	root := t.TempDir()
	parsed, err := parseLoopFlags("flow", []string{"automation-alert", "-edition", "free", "-root", root}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.section != "automation-alert" || parsed.edition != EditionFree {
		t.Fatalf("the section may come before the flags: %+v", parsed)
	}

	first := LoopOptions(*parsed, &Config{})
	if !first.Keep || first.Resume || !first.Follow || !first.PinMain || first.SkipWorks || first.RunDir != LoopDir(root) {
		t.Fatalf("the first call boots and keeps: %+v", first)
	}
	if err := os.MkdirAll(first.RunDir, 0o750); err != nil {
		t.Fatal(err)
	}
	unmark, err := MarkRun(first.RunDir, true)
	if err != nil {
		t.Fatal(err)
	}
	unmark()
	if second := LoopOptions(*parsed, &Config{}); !second.Resume {
		t.Fatalf("a second call reuses the kept stack: %+v", second)
	}

	verdict := LoopVerdict([]Row{
		flowRow(100, ClassNoise, `text "VD Automation"`, "", ""),
		{Edition: EditionEnterprise, Kind: "route", Key: "/b", Class: ClassBlank, Why: "blank page"},
	}, "/loop/verdict.md")
	for _, want := range []string{"flow automation-create [enterprise]: works (1 expects held)", "route /b [enterprise]: blank · blank page", "verdict: /loop/verdict.md"} {
		mustContain(t, verdict, want)
	}

	var out bytes.Buffer
	if err := StopLoop(context.Background(), GCRequest{Root: root, Run: (&fakeRunner{}).run, Out: &out}); err != nil {
		t.Fatal(err)
	}
	if dirExists(LoopDir(root)) {
		t.Fatal("down removes the loop's directory, its seed marker with it")
	}
	mustContain(t, out.String(), "stale run loop")
}

// followFake answers rev-parse with the ref's commit in the root and the
// worktree's own commit anywhere else.
type followFake struct {
	commands []string
}

func (fake *followFake) run(_ context.Context, spec commandSpec, log io.Writer) error {
	fake.commands = append(fake.commands, spec.name+" "+strings.Join(spec.args, " "))
	if spec.args[0] == "rev-parse" {
		commit := worksCommit
		if spec.dir == "/repo" {
			commit = testBaseCommit
		}
		_, err := io.WriteString(log, commit+"\n")
		return err
	}
	return nil
}

func TestAResumedLoopWorktreeFollowsTheCandidatesCommit(t *testing.T) {
	fake := &followFake{}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	run := &session{
		request: Request{Options: Options{Root: "/repo", Follow: true}, Deps: Deps{
			Run: fake.run, CopyEnv: func(context.Context, string, string) (int, error) { return 0, nil },
		}},
		streams: Streams{Out: io.Discard, Err: io.Discard},
	}
	stack := Stack{Name: "candidate", Ref: "HEAD", Dir: dir, Persistent: true, Layout: LayoutModular}

	if err := run.follow(context.Background(), stack); err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(fake.commands, "\n")
	mustContain(t, joined, "git checkout --detach --force "+testBaseCommit)
	mustContain(t, joined, "pnpm")
	fake.commands = nil
	run.request.Options.Follow = false
	if err := run.follow(context.Background(), stack); err != nil || len(fake.commands) != 0 {
		t.Fatalf("only the fix loop follows: %v", fake.commands)
	}
}
