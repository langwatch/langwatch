package visualdiff

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

type recordedCommand struct {
	name string
	args []string
	dir  string
}

type fakeRunner struct {
	commands []recordedCommand
	fail     map[string]error
}

func (fake *fakeRunner) run(_ context.Context, spec commandSpec, _ io.Writer) error {
	fake.commands = append(fake.commands, recordedCommand{spec.name, spec.args, spec.dir})
	return fake.fail[strings.Join(append([]string{spec.name}, spec.args...), " ")]
}

func (fake *fakeRunner) rendered() []string {
	out := make([]string, 0, len(fake.commands))
	for _, command := range fake.commands {
		out = append(out, command.name+" "+strings.Join(command.args, " "))
	}
	return out
}

// @scenario A run tears its stacks down even when a step fails
func TestTeardownKillsByProcessGroupAndRemovesTheWorktrees(t *testing.T) {
	fake := &fakeRunner{}
	teardown := Teardown{Root: "/repo", Run: fake.run, Listening: func(int) bool { return false }}

	err := teardown.Do(context.Background(), []int{5670, 6670, 3109}, []string{"/run/base", "/run/candidate"})

	if err != nil {
		t.Fatal(err)
	}
	commands := fake.rendered()
	if commands[0] != "bash "+KillDevTreeScript+" 5670,6670,3109" {
		t.Fatalf("ports are freed by process group through the repository's own script: %v", commands)
	}
	if commands[1] != "git worktree remove --force /run/base" || commands[2] != "git worktree remove --force /run/candidate" {
		t.Fatalf("both worktrees should be removed: %v", commands)
	}
	for _, command := range fake.commands {
		if command.dir != "/repo" {
			t.Fatalf("teardown must run from the repository root: %+v", command)
		}
	}
}

// @scenario Teardown reports a port it could not free
func TestTeardownReportsAPortItCouldNotFree(t *testing.T) {
	fake := &fakeRunner{}
	teardown := Teardown{Root: "/repo", Run: fake.run, Listening: func(port int) bool { return port == 6670 }}

	err := teardown.Do(context.Background(), []int{5670, 6670}, nil)

	if err == nil {
		t.Fatal("a port still listening after teardown was reported as clean")
	}
	mustContain(t, err.Error(), "port 6670 is still listening")
}

// @scenario Teardown reports a port it could not free
func TestTeardownKeepsGoingAfterAFailedStep(t *testing.T) {
	fake := &fakeRunner{fail: map[string]error{
		"bash " + KillDevTreeScript + " 5670": errors.New("no lsof"),
	}}
	teardown := Teardown{Root: "/repo", Run: fake.run, Listening: func(int) bool { return false }}

	err := teardown.Do(context.Background(), []int{5670}, []string{"/run/base"})

	if err == nil || !strings.Contains(err.Error(), "no lsof") {
		t.Fatalf("the kill failure should be reported: %v", err)
	}
	if len(fake.commands) != 2 {
		t.Fatalf("the worktree removal must still run: %v", fake.rendered())
	}
}

func TestTeardownHonoursKeep(t *testing.T) {
	fake := &fakeRunner{}
	teardown := Teardown{Root: "/repo", Run: fake.run, Keep: true}

	if err := teardown.Do(context.Background(), []int{5670}, []string{"/run/base"}); err != nil {
		t.Fatal(err)
	}
	if len(fake.commands) != 0 {
		t.Fatalf("-keep must touch nothing: %v", fake.rendered())
	}
}

func TestExecRunnerRefusesAnUnlistedExecutable(t *testing.T) {
	err := execRunner(context.Background(), commandSpec{name: "curl"}, io.Discard)

	if err == nil {
		t.Fatal("an unlisted executable was run")
	}
}
