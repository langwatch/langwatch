package app

import (
	"errors"
	"fmt"
	"slices"
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

// @scenario "Untrusted code takes a second, deliberate confirmation"
func TestSecondStepTakesOnlyThePRNumber(t *testing.T) {
	const number = 4913
	// The reflex answers are exactly the ones that must not pass — the second
	// step exists because the first one is clearable without reading it.
	for _, answer := range []string{"", "\n", "  ", "y", "y\n", "yes", "Y", "n", "4912", "49130", "#4912", "play 4913", "4913x"} {
		if PlayConfirmationAccepted(answer, number) {
			t.Errorf("PlayConfirmationAccepted(%q) = true, want false — only the PR number may pass the second step", answer)
		}
	}
	// Typing the number does pass, in the forms a developer actually types it:
	// with the trailing newline the reader hands over, and with the "#" GitHub
	// puts in front of it everywhere they just read it.
	for _, answer := range []string{"4913", "4913\n", "  4913  \n", "#4913", "# 4913\n"} {
		if !PlayConfirmationAccepted(answer, number) {
			t.Errorf("PlayConfirmationAccepted(%q) = false, want true", answer)
		}
	}
	if !strings.Contains(PlayConfirmationPrompt(number), "4913") {
		t.Errorf("the second step's prompt %q does not name the number it wants typed", PlayConfirmationPrompt(number))
	}
}

// @scenario "Every untrusted path says what the code is given"
func TestEveryUntrustedPathDisclosesTheAmbientAuthority(t *testing.T) {
	// The literal is spelled out here rather than shared with the code on
	// purpose: the guarantee is that three independently-written paths all still
	// say it, so reading it from the same constant they use would assert nothing.
	// (The --allow-untrusted warning is the third; it prints this exposure text.)
	const disclosure = "as you, from this shell's environment"
	paths := map[string]string{
		"the second confirmation step": PlayUntrustedExposure(),
		"the agent-mode failure":       PlayTrustError([]string{"mallory"}).Error(),
	}
	for name, text := range paths {
		if !strings.Contains(text, disclosure) {
			t.Errorf("%s does not say the code runs %q:\n%s", name, disclosure, text)
		}
	}
	// It must also still say what IS isolated, or the warning reads as "the
	// sandbox is pointless" and gets ignored wholesale.
	if !strings.Contains(PlayUntrustedExposure(), ".env") {
		t.Error("the exposure text drops the .env guarantee, leaving only the scary half")
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

// forkCommit builds a fork PR commit whose GitHub-attributed login is `login`
// — the field an attacker steers by choosing a commit email — with `verified`
// controlling whether GitHub actually validated a signature over its contents.
func forkCommit(sha, login, name string, verified bool) ghPRCommit {
	c := ghPRCommit{SHA: sha}
	if login != "" {
		c.Author = &struct {
			Login string `json:"login"`
		}{Login: login}
		c.Committer = &struct {
			Login string `json:"login"`
		}{Login: login}
	}
	c.Commit.Author.Name = name
	c.Commit.Author.Email = name + "@example.com"
	c.Commit.Verification.Verified = verified
	return c
}

// The gate's whole job is to stop a stranger's code running unprompted. On a
// fork, GitHub's author/committer attribution is derived from the commit's email
// header, which the PR author chooses — so an unsigned commit claiming to be a
// maintainer must not buy any trust at all.
//
// @scenario "A fork commit claiming a maintainer's identity is still untrusted"
// @scenario "A fork commit is trusted only when a verified signer has write access"
// @scenario "One unsigned commit taints a fork PR"
func TestForkCommitAttributionIsNotTrustedWithoutASignature(t *testing.T) {
	// Every maintainer login would pass a permission check; that is the point.
	everyoneHasWrite := func(string) bool { return true }

	t.Run("given a fork commit that merely claims a maintainer's identity", func(t *testing.T) {
		t.Run("when the commit carries no verified signature, it is untrusted", func(t *testing.T) {
			commits := []ghPRCommit{forkCommit("deadbeefcafe", "trusted-maintainer", "Trusted Maintainer", false)}
			untrusted := untrustedForkCommits(commits, everyoneHasWrite)
			if len(untrusted) != 1 {
				t.Fatalf("a spoofable unsigned fork commit must be untrusted, got %v", untrusted)
			}
			if !strings.Contains(untrusted[0], "deadbee") {
				t.Errorf("the warning should name the commit, got %q", untrusted[0])
			}
		})

		t.Run("when the commit is verified and the signer has write access, it is trusted", func(t *testing.T) {
			commits := []ghPRCommit{forkCommit("deadbeefcafe", "trusted-maintainer", "Trusted Maintainer", true)}
			if untrusted := untrustedForkCommits(commits, everyoneHasWrite); len(untrusted) != 0 {
				t.Errorf("a verified commit from a writer is trusted, got %v", untrusted)
			}
		})

		t.Run("when the commit is verified but the signer lacks write access, it is untrusted", func(t *testing.T) {
			commits := []ghPRCommit{forkCommit("deadbeefcafe", "outsider", "Outsider", true)}
			nobodyHasWrite := func(string) bool { return false }
			if untrusted := untrustedForkCommits(commits, nobodyHasWrite); len(untrusted) != 1 {
				t.Errorf("a verified signer without write access is untrusted, got %v", untrusted)
			}
		})
	})

	t.Run("given a fork PR where only some commits are signed", func(t *testing.T) {
		// The head commit is what actually runs, so one unsigned commit anywhere
		// has to stop the whole thing.
		t.Run("when any commit is unsigned, the PR is untrusted", func(t *testing.T) {
			commits := []ghPRCommit{
				forkCommit("1111111aaaa", "trusted-maintainer", "Trusted Maintainer", true),
				forkCommit("2222222bbbb", "trusted-maintainer", "Trusted Maintainer", false),
			}
			if untrusted := untrustedForkCommits(commits, everyoneHasWrite); len(untrusted) != 1 {
				t.Errorf("one unsigned commit must taint the PR, got %v", untrusted)
			}
		})
	})
}

// @scenario "A commit listing that hits GitHub's cap fails closed"
func TestTruncatedCommitListingFailsClosed(t *testing.T) {
	t.Run("given a listing below GitHub's cap", func(t *testing.T) {
		t.Run("when the gate reads it, the listing is complete and usable", func(t *testing.T) {
			if err := errIfCommitListingTruncated(7, playPRCommitsAPICap-1); err != nil {
				t.Errorf("a complete listing must be accepted, got %v", err)
			}
		})
	})

	t.Run("given a listing that reached GitHub's cap", func(t *testing.T) {
		// The cap withholds the NEWEST commits, which are the ones that run.
		t.Run("when the gate reads it, play refuses rather than vouching for it", func(t *testing.T) {
			err := errIfCommitListingTruncated(7, playPRCommitsAPICap)
			if err == nil {
				t.Fatal("a truncated listing must not be treated as complete")
			}
			if !strings.Contains(err.Error(), "--allow-untrusted") {
				t.Errorf("the error should name the explicit way past, got %q", err)
			}
		})
	})
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
	newRecorder := func(ran *[]string) func(string, error) func() error {
		return func(name string, err error) func() error {
			return func() error {
				*ran = append(*ran, name)
				return err
			}
		}
	}

	t.Run("given every resource step succeeds", func(t *testing.T) {
		t.Run("when teardown runs, every step runs in order and the record is dropped", func(t *testing.T) {
			var ran []string
			step := newRecorder(&ran)
			err := runPlayTeardown(playTeardownPlan(PlayTeardownHooks{
				StopProcesses:    step("stop processes", nil),
				RemoveRoutes:     step("remove routes", nil),
				RemoveContainers: step("remove containers", nil),
				RemoveVolumes:    step("remove volumes", nil),
				RemoveCheckout:   step("remove checkout", nil),
				RemoveRecord:     step("remove record", nil),
			}), nil)
			want := []string{"stop processes", "remove routes", "remove containers", "remove volumes", "remove checkout", "remove record"}
			if strings.Join(ran, "|") != strings.Join(want, "|") {
				t.Errorf("teardown ran %v, want %v (fixed order)", ran, want)
			}
			if err != nil {
				t.Errorf("a clean teardown must not error, got %v", err)
			}
		})
	})

	// The record is what makes a sandbox findable. Dropping it after a failed
	// teardown strands whatever survived — containers, volumes, a checkout —
	// with nothing left able to reap them, while the banner claimed nothing
	// survives.
	t.Run("given a resource step fails", func(t *testing.T) {
		t.Run("when teardown runs, the later steps still run but the record is kept", func(t *testing.T) {
			var ran []string
			step := newRecorder(&ran)
			volumeErr := errors.New("volume still in use")
			err := runPlayTeardown(playTeardownPlan(PlayTeardownHooks{
				StopProcesses:    step("stop processes", nil),
				RemoveRoutes:     step("remove routes", nil),
				RemoveContainers: step("remove containers", nil),
				RemoveVolumes:    step("remove volumes", volumeErr),
				RemoveCheckout:   step("remove checkout", nil),
				RemoveRecord:     step("remove record", nil),
			}), nil)

			if slices.Contains(ran, "remove record") {
				t.Error("the record must be kept after a failed teardown so `haven clean` can finish it")
			}
			// Best-effort still holds for everything else.
			if !slices.Contains(ran, "remove checkout") {
				t.Errorf("a failure must not stop the remaining resource steps, ran %v", ran)
			}
			if err == nil || !errors.Is(err, volumeErr) {
				t.Errorf("teardown err = %v, want it to carry the failing step's error", err)
			}
		})
	})
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
