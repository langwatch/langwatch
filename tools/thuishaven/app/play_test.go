package app

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A play ref is a PR number or URL"
func TestPlayRefAcceptsNumbersAndPRURLs(t *testing.T) {
	cases := map[string]bool{
		"4913": true,
		"https://github.com/langwatch/langwatch/pull/4913": true,
		"":                        false,
		"0":                       false,
		"main":                    false,
		"feat/x":                  false,
		"https://example.com/foo": false,
	}
	for in, want := range cases {
		if got := ValidPlayRef(in); got != want {
			t.Errorf("ValidPlayRef(%q) = %v, want %v", in, got, want)
		}
	}
}

func writeAccessByLogin(perms map[string]string) func(string) bool {
	return func(login string) bool { return PermissionGrantsWrite(perms[login]) }
}

// @scenario "Authors with write access proceed without a prompt"
func TestFullyTrustedPRProceedsInEveryMode(t *testing.T) {
	ids := []PlayIdentity{{Login: "alice", Display: "alice"}, {Login: "bob", Display: "bob"}}
	untrusted := UntrustedPlayAuthors(ids, writeAccessByLogin(map[string]string{"alice": "admin", "bob": "write"}))
	if len(untrusted) != 0 {
		t.Fatalf("untrusted = %v, want none", untrusted)
	}
	for _, isAgent := range []bool{false, true} {
		if got := DecidePlayTrust(len(untrusted), isAgent, false); got != PlayProceed {
			t.Errorf("DecidePlayTrust(0, agent=%v, allow=false) = %v, want PlayProceed", isAgent, got)
		}
	}
}

// @scenario "An untrusted author stops play until explicitly confirmed"
func TestUntrustedAuthorRequiresAPrompt(t *testing.T) {
	ids := []PlayIdentity{{Login: "alice", Display: "alice"}, {Login: "mallory", Display: "mallory"}}
	untrusted := UntrustedPlayAuthors(ids, writeAccessByLogin(map[string]string{"alice": "write", "mallory": "read"}))
	if len(untrusted) != 1 || untrusted[0] != "mallory" {
		t.Fatalf("untrusted = %v, want [mallory] — the warning must NAME the untrusted authors", untrusted)
	}
	if got := DecidePlayTrust(len(untrusted), false, false); got != PlayPrompt {
		t.Errorf("DecidePlayTrust in a terminal = %v, want PlayPrompt (default no)", got)
	}
	// The explicit opt-in skips the prompt.
	if got := DecidePlayTrust(len(untrusted), false, true); got != PlayProceed {
		t.Errorf("DecidePlayTrust with --allow-untrusted = %v, want PlayProceed", got)
	}
}

// @scenario "A commit with no GitHub account is untrusted"
func TestLoginlessCommitIsUntrusted(t *testing.T) {
	commits := []ghPRCommit{{}}
	commits[0].Commit.Author.Name, commits[0].Commit.Author.Email = "Ghost Writer", "ghost@example.com"
	commits[0].Commit.Committer.Name, commits[0].Commit.Committer.Email = "Ghost Writer", "ghost@example.com"
	ids := playIdentitiesFromCommits(commits)
	if len(ids) != 1 || ids[0].Login != "" {
		t.Fatalf("ids = %+v, want one login-less identity", ids)
	}
	// Even a permission oracle that trusts everyone cannot vouch for an
	// identity with no account behind it.
	untrusted := UntrustedPlayAuthors(ids, func(string) bool { return true })
	if len(untrusted) != 1 || !strings.Contains(untrusted[0], "ghost@example.com") {
		t.Errorf("untrusted = %v, want the login-less author named by email", untrusted)
	}
}

// @scenario "Agent mode never prompts about trust"
func TestAgentModeFailsNamingTheFlag(t *testing.T) {
	untrusted := []string{"mallory", "trent"}
	if got := DecidePlayTrust(len(untrusted), true, false); got != PlayFail {
		t.Fatalf("DecidePlayTrust(agent) = %v, want PlayFail", got)
	}
	err := PlayTrustError(untrusted)
	for _, want := range []string{"mallory", "trent", "--allow-untrusted"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("agent-mode error %q does not mention %q", err, want)
		}
	}
	// With the explicit flag the agent proceeds.
	if got := DecidePlayTrust(len(untrusted), true, true); got != PlayProceed {
		t.Errorf("DecidePlayTrust(agent, --allow-untrusted) = %v, want PlayProceed", got)
	}
}

func TestWebFlowCommitterIsNotAnAuthor(t *testing.T) {
	// GitHub itself commits as web-flow for web-UI edits; it is not a person
	// whose access could be checked and must not poison the gate.
	c := ghPRCommit{
		Author: &struct {
			Login string `json:"login"`
		}{Login: "alice"},
		Committer: &struct {
			Login string `json:"login"`
		}{Login: "web-flow"},
	}
	ids := playIdentitiesFromCommits([]ghPRCommit{c})
	if len(ids) != 1 || ids[0].Login != "alice" {
		t.Errorf("ids = %+v, want only alice (web-flow skipped)", ids)
	}
}

func TestPermissionGrantsWrite(t *testing.T) {
	cases := map[string]bool{
		"admin": true, "write": true, "maintain": true,
		"read": false, "triage": false, "none": false, "": false,
	}
	for perm, want := range cases {
		if got := PermissionGrantsWrite(perm); got != want {
			t.Errorf("PermissionGrantsWrite(%q) = %v, want %v", perm, got, want)
		}
	}
}

// sharedDataNames are the shared volumes and slugs a sandbox must never be
// able to collide with: the legacy compose volumes, the shared managed
// container, and `haven pr`'s worktree slug shape.
var sharedDataNames = []string{
	"langwatch-db-data",
	"langwatch-clickhouse-data",
	"langwatch-redis-data",
	"langwatch-clickhouse",
}

// @scenario "The sandbox can never touch shared data"
func TestPlayNamesAreDisjointFromSharedData(t *testing.T) {
	for _, n := range []int{1, 42, 4913, 999999} {
		for _, engine := range []string{"postgres", "clickhouse", "redis"} {
			for _, name := range []string{PlayContainerName(n, engine), PlayVolumeName(n, engine)} {
				if !strings.HasPrefix(name, "haven-play-") {
					t.Errorf("%q lacks the haven-play- prefix", name)
				}
				for _, shared := range sharedDataNames {
					if name == shared {
						t.Errorf("play name %q equals the shared %q", name, shared)
					}
				}
			}
		}
		// The hostname slug is play-<n>, never the pr-<n> a `haven pr` checkout
		// owns — the two must be able to coexist for the same PR.
		if PlaySlug(n) == fmt.Sprintf("pr-%d", n) {
			t.Errorf("PlaySlug(%d) collides with haven pr's slug", n)
		}
		if !domain.ValidSlug(PlaySlug(n)) {
			t.Errorf("PlaySlug(%d) = %q is not a valid slug", n, PlaySlug(n))
		}
		// And the branch never collides with haven pr's.
		if PlayBranch(n) == prBranchName(n) {
			t.Errorf("PlayBranch(%d) collides with haven pr's branch", n)
		}
	}
}

func TestPlayInfraShellsUseOwnPortsAndVolumes(t *testing.T) {
	pg := playPostgresShell(77, 55432, "lw_play_77")
	ch := playClickHouseShell(77, 58123, "lw_play_77")
	rd := playRedisShell(77, 56379)
	for shell, wants := range map[string][]string{
		pg: {"haven-play-77-postgres", "haven-play-77-postgres-data:", "-p 127.0.0.1:55432:5432", "POSTGRES_DB=lw_play_77"},
		ch: {"haven-play-77-clickhouse", "haven-play-77-clickhouse-data:", "-p 127.0.0.1:58123:8123", "CLICKHOUSE_DB=lw_play_77"},
		rd: {"haven-play-77-redis", "haven-play-77-redis-data:", "-p 127.0.0.1:56379:6379"},
	} {
		for _, want := range wants {
			if !strings.Contains(shell, want) {
				t.Errorf("shell missing %q:\n%s", want, shell)
			}
		}
		for _, shared := range sharedDataNames {
			if strings.Contains(shell, shared) {
				t.Errorf("shell mentions shared resource %q:\n%s", shared, shell)
			}
		}
	}
}

// @scenario "Quitting always destroys everything"
func TestPlayTeardownRunsEveryStepInOrderBestEffort(t *testing.T) {
	var ran []string
	step := func(name string, err error) func() error {
		return func() error {
			ran = append(ran, name)
			return err
		}
	}
	routeErr := errors.New("proxy is down")
	err := runPlayTeardown(playTeardownPlan(PlayTeardownHooks{
		StopProcesses:    step("stop processes", nil),
		RemoveRoutes:     step("remove routes", routeErr), // an early failure...
		RemoveContainers: step("remove containers", nil),
		RemoveVolumes:    step("remove volumes", nil),
		RemoveCheckout:   step("remove checkout", nil),
		RemoveRecord:     step("remove record", nil),
	}), nil)
	want := []string{"stop processes", "remove routes", "remove containers", "remove volumes", "remove checkout", "remove record"}
	if strings.Join(ran, "|") != strings.Join(want, "|") {
		t.Errorf("teardown ran %v, want %v (fixed order, no early stop)", ran, want)
	}
	if err == nil || !errors.Is(err, routeErr) {
		t.Errorf("teardown err = %v, want it to carry the failing step's error", err)
	}
}

// @scenario "A crashed play is discoverable and reapable"
func TestPlayRecordsSurviveACrashAndOnlyDeadOnesReap(t *testing.T) {
	home := t.TempDir()
	// The record is written before any resource exists...
	rec := PlayRecord{Number: 4913, Slug: PlaySlug(4913), PID: 12345, Checkout: "/tmp/x", RepoRoot: "/tmp/repo"}
	if err := WritePlayRecord(home, rec); err != nil {
		t.Fatalf("WritePlayRecord: %v", err)
	}
	live := PlayRecord{Number: 100, Slug: PlaySlug(100), PID: 999, Checkout: "/tmp/y"}
	if err := WritePlayRecord(home, live); err != nil {
		t.Fatalf("WritePlayRecord: %v", err)
	}
	recs := ReadPlayRecords(home)
	if len(recs) != 2 {
		t.Fatalf("ReadPlayRecords = %d records, want 2", len(recs))
	}
	// ...and only the one whose owner process died is offered for reaping.
	orphans := PlaysToReap(recs, func(pid int) bool { return pid == 999 })
	if len(orphans) != 1 || orphans[0].Number != 4913 {
		t.Fatalf("PlaysToReap = %+v, want only pr-4913", orphans)
	}
	RemovePlayRecord(home, 4913)
	if got := ReadPlayRecords(home); len(got) != 1 || got[0].Number != 100 {
		t.Errorf("after removal ReadPlayRecords = %+v, want only pr-100", got)
	}
}

// @scenario "Destruction is disclosed up front, not confirmed at the end"
func TestPlayDisclosureNamesEverythingDestroyed(t *testing.T) {
	banner := PlayDisclosure(4913)
	for _, want := range []string{"destroyed", "databases", "containers", "checkout"} {
		if !strings.Contains(strings.ToLower(banner), want) {
			t.Errorf("disclosure banner does not mention %q:\n%s", want, banner)
		}
	}
}

func TestPlayCheckoutLivesUnderTheHavenHome(t *testing.T) {
	got := PlayCheckoutDir("/Users/x/.langwatch/portless", 4913)
	if got != "/Users/x/.langwatch/portless/play/pr-4913" {
		t.Errorf("PlayCheckoutDir = %q", got)
	}
}

// Teardown deletes the recorded checkout recursively, so the record alone must
// never be able to point that deletion outside the play area.
func TestPlayCheckoutContainmentRefusesEscapes(t *testing.T) {
	home := "/Users/x/.langwatch/portless"
	cases := map[string]bool{
		PlayCheckoutDir(home, 4913): true,
		home + "/play/anything":     true,
		home:                        false,
		home + "/play":              false, // the area itself, not a sandbox in it
		home + "/play/../..":        false,
		home + "/playground/pr-1":   false, // prefix look-alike
		"/Users/x/Source/real-repo": false,
		"":                          false,
	}
	for checkout, want := range cases {
		if got := PlayCheckoutContained(home, checkout); got != want {
			t.Errorf("PlayCheckoutContained(%q) = %v, want %v", checkout, got, want)
		}
	}
	if PlayCheckoutContained("", home+"/play/pr-1") {
		t.Error("an empty home must refuse every checkout")
	}
}
