package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// haven play: run a GitHub PR in a throwaway sandbox. Everything here is
// deliberately disjoint from the shared local-dev estate: the sandbox gets its
// own checkout, its own Postgres/ClickHouse/Redis containers and volumes
// (play-prefixed names, freshly allocated loopback ports), and its own play-<n>
// hostname slug. Quitting the attached view destroys all of it, every time -
// the opposite contract to `haven up`, where quitting detaches. Because the
// data is ephemeral by contract, teardown needs no --yes; the help text and
// the first-run banner disclose the destruction up front (ADR-064's
// data-loss-is-explicit rule, satisfied by disclosure instead of confirmation).

// ValidPlayRef reports whether ref names a PR (a number or a GitHub pull URL) -
// the same shapes `haven pr` accepts, checked before anything shells out.
func ValidPlayRef(ref string) bool { return looksLikePRRef(ref) }

// ResolvePlayPR resolves a play ref to the PR's number/state/head via gh.
func ResolvePlayPR(ctx context.Context, repoRoot, ref string) (PlayPR, error) {
	ref = strings.TrimSpace(ref)
	if !ValidPlayRef(ref) {
		return PlayPR{}, fmt.Errorf(
			"usage: haven play [number|github-pr-url] [--allow-untrusted]\n" +
				"  e.g. haven play 4913  |  haven play https://github.com/langwatch/langwatch/pull/4913\n" +
				"  with no argument (in a terminal) haven play offers the open PRs to pick from")
	}
	view, err := resolvePR(ctx, repoRoot, ref)
	if err != nil {
		return PlayPR{}, err
	}
	pr := PlayPR{Number: view.Number, State: view.State, HeadRefName: view.HeadRefName, Title: "", URL: view.URL}
	fork, title, err := playPRProvenance(ctx, repoRoot, view.Number)
	if err != nil {
		return PlayPR{}, err
	}
	pr.IsCrossRepository = fork
	pr.Title = title
	return pr, nil
}

// playPRProvenance reads the two facts the trust gate cannot infer from commit
// metadata: whether the head branch lives in a fork, and the PR's title (shown
// in the disclosure banner so the user confirms against something readable).
//
// isCrossRepository is load-bearing, not cosmetic: a same-repo head branch can
// only exist because someone with push access created it, whereas a fork's
// contents are controlled entirely by the PR author.
func playPRProvenance(ctx context.Context, repoRoot string, number int) (bool, string, error) {
	cmd := exec.CommandContext(ctx, "gh", "pr", "view", strconv.Itoa(number),
		"--json", "isCrossRepository,title")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return false, "", fmt.Errorf("could not read PR #%d's provenance via gh%s", number, gitStderrHint(err))
	}
	var view struct {
		IsCrossRepository bool   `json:"isCrossRepository"`
		Title             string `json:"title"`
	}
	if err := json.Unmarshal(out, &view); err != nil {
		return false, "", fmt.Errorf("unexpected gh output for PR #%d: %w", number, err)
	}
	return view.IsCrossRepository, view.Title, nil
}

// PlayPR is the slice of a PR that play needs.
type PlayPR struct {
	Number      int    `json:"number"`
	State       string `json:"state"`
	HeadRefName string `json:"headRefName"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	// IsCrossRepository reports that the head branch lives in a fork, so nothing
	// about its commits implies repo write access. See playPRProvenance.
	IsCrossRepository bool `json:"isCrossRepository"`
}

// ListOpenPlayPRs returns the repo's open PRs for the no-argument picker.
func ListOpenPlayPRs(ctx context.Context, repoRoot string) ([]PlayPR, error) {
	cmd := exec.CommandContext(ctx, "gh", "pr", "list",
		"--state", "open", "--limit", "100",
		"--json", "number,title,headRefName,url")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("could not list open PRs via gh (is it authed? run `gh auth login`)%s", gitStderrHint(err))
	}
	var prs []PlayPR
	if err := json.Unmarshal(out, &prs); err != nil {
		return nil, fmt.Errorf("unexpected gh pr list output: %w", err)
	}
	return prs, nil
}

// --- the trust gate ---

// PlayIdentity is one distinct commit identity on the PR: a GitHub login when
// the commit maps to an account, else just the commit's name/email.
type PlayIdentity struct {
	Login   string // "" when the commit maps to no GitHub account
	Display string // what the warning shows: the login, or "Name <email>"
}

// ghPRCommit is the slice of the pulls/N/commits payload the gate reads.
//
// A note on what is and is not trustworthy here. `commit.author` / `commit.committer`
// are raw git headers: free text the pusher chose. GitHub's top-level `author` /
// `committer` objects look authoritative but are only a lookup of those same
// attacker-chosen email headers against accounts' verified addresses — and the
// `<id>+<login>@users.noreply.github.com` form is publicly derivable for any
// user. Neither field authenticates anybody. Only `commit.verification` does,
// because it is a signature check GitHub performed over the commit contents.
type ghPRCommit struct {
	SHA    string `json:"sha"`
	Author *struct {
		Login string `json:"login"`
	} `json:"author"`
	Committer *struct {
		Login string `json:"login"`
	} `json:"committer"`
	Commit struct {
		Author       struct{ Name, Email string } `json:"author"`
		Committer    struct{ Name, Email string } `json:"committer"`
		Verification struct {
			Verified bool `json:"verified"`
		} `json:"verification"`
	} `json:"commit"`
}

// verifiedSigner returns the login GitHub cryptographically verified as having
// signed this commit, or "" when the commit carries no valid signature.
//
// GitHub reports the signer through the same resolved-account object as the
// author, but gated on `verification.verified`, which only passes when the
// signature validates against a key that account registered. That is the one
// commit-level fact an attacker cannot forge without the key.
func (c ghPRCommit) verifiedSigner() string {
	if !c.Commit.Verification.Verified {
		return ""
	}
	if c.Committer != nil && c.Committer.Login != "" {
		return c.Committer.Login
	}
	if c.Author != nil && c.Author.Login != "" {
		return c.Author.Login
	}
	return ""
}

// shortSHA is the display form for naming an individual untrusted commit.
func (c ghPRCommit) shortSHA() string {
	if len(c.SHA) > 7 {
		return c.SHA[:7]
	}
	return c.SHA
}

// webFlowLogin is GitHub's own service account, the committer on every commit
// made through the GitHub web UI (suggestions, web edits, merge commits). It is
// GitHub itself, not a person whose access could be checked, so the gate skips
// it rather than flagging every web-made commit as untrusted.
const webFlowLogin = "web-flow"

// playIdentitiesFromCommits reduces a PR's commits to the distinct identities
// behind them - every author AND committer, since either wrote code that will
// run on this machine. Identities are keyed by login (case-insensitive) when
// one exists, else by the commit name/email pair.
func playIdentitiesFromCommits(commits []ghPRCommit) []PlayIdentity {
	seen := map[string]bool{}
	var out []PlayIdentity
	add := func(login, name, email string) {
		if strings.EqualFold(login, webFlowLogin) {
			return
		}
		key := strings.ToLower(login)
		display := login
		if login == "" {
			display = fmt.Sprintf("%s <%s> (no GitHub account)", name, email)
			key = strings.ToLower(display)
		}
		if key == "" || seen[key] {
			return
		}
		seen[key] = true
		out = append(out, PlayIdentity{Login: login, Display: display})
	}
	for _, c := range commits {
		authorLogin, committerLogin := "", ""
		if c.Author != nil {
			authorLogin = c.Author.Login
		}
		if c.Committer != nil {
			committerLogin = c.Committer.Login
		}
		add(authorLogin, c.Commit.Author.Name, c.Commit.Author.Email)
		add(committerLogin, c.Commit.Committer.Name, c.Commit.Committer.Email)
	}
	return out
}

// PermissionGrantsWrite reports whether a collaborator permission level from
// the GitHub API means "can push to this repo".
func PermissionGrantsWrite(permission string) bool {
	switch strings.ToLower(strings.TrimSpace(permission)) {
	case "admin", "maintain", "write":
		return true
	}
	return false
}

// UntrustedPlayAuthors returns the display names of every identity without
// write access, sorted. hasWrite answers for a login; an identity with no
// login never has write access (there is no account to check).
func UntrustedPlayAuthors(ids []PlayIdentity, hasWrite func(login string) bool) []string {
	var out []string
	for _, id := range ids {
		if id.Login != "" && hasWrite(id.Login) {
			continue
		}
		out = append(out, id.Display)
	}
	sort.Strings(out)
	return out
}

// PlayTrustAction is what the gate decided.
type PlayTrustAction int

const (
	// PlayProceed: every identity is trusted (or the user explicitly opted past
	// the gate) - continue without a prompt.
	PlayProceed PlayTrustAction = iota
	// PlayPrompt: untrusted identities in a terminal - ask, default no.
	PlayPrompt
	// PlayFail: untrusted identities in agent mode - there is no prompt to give,
	// fail and name the explicit flag.
	PlayFail
)

// DecidePlayTrust is the pure trust-gate decision: proceed when every author
// has write access or the user passed --allow-untrusted; otherwise prompt in a
// terminal and fail in agent mode (an agent has no y/N to answer).
func DecidePlayTrust(untrustedCount int, isAgent, allowUntrusted bool) PlayTrustAction {
	if untrustedCount == 0 || allowUntrusted {
		return PlayProceed
	}
	if isAgent {
		return PlayFail
	}
	return PlayPrompt
}

// PlayTrustError is the agent-mode failure: it names the untrusted authors, says
// what running them would grant, and names the one explicit flag that proceeds
// anyway.
func PlayTrustError(untrusted []string) error {
	return fmt.Errorf(
		"PR authors without write access to this repo: %s\n"+
			"haven play runs their code on this machine as you, from this shell's environment,\n"+
			"so it will not proceed unprompted.\n"+
			"Re-run with --allow-untrusted to accept that explicitly.",
		strings.Join(untrusted, ", "))
}

// PlayUntrustedExposure is the second step of the interactive trust gate: what
// accepting an unreviewed PR actually costs.
//
// The sandbox's isolation is real, but it isolates the PR's *data* — its own
// databases, volumes, hostnames and checkout, and none of the developer's .env
// files. It is not a boundary around the developer. The install, migrations,
// seed and service commands are ordinary child processes of this command, so
// they run under the developer's own account and inherit the environment haven
// was launched from; whatever that shell exports travels with them. Naming that
// is the whole point of the step, because the y/N before it can be cleared by
// reflex without ever disclosing it.
//
// Every path that accepts untrusted code carries the same sentence — this text,
// the --allow-untrusted warning, and PlayTrustError — so no route to running a
// stranger's code is quieter than the others.
func PlayUntrustedExposure() string {
	return "" +
		"  What the sandbox does NOT isolate: the PR's install, migrations, seed and\n" +
		"  services run as you, from this shell's environment. Anything it exports goes\n" +
		"  with them — SSH agent socket, GitHub, cloud and registry tokens — and your\n" +
		"  home directory and network are reachable the whole time.\n" +
		"  What it does isolate: its databases, volumes and hostnames are its own, and\n" +
		"  it gets none of your .env files.\n" +
		"  Reading the diff first is the only thing that narrows this.\n"
}

// PlayConfirmationAccepted reports whether the second step's answer is the PR's
// own number typed back. Nothing else passes.
//
// That is the point of the step: it cannot be cleared by the same reflex "y"
// that cleared the first prompt, and answering it means having read far enough
// to know which PR is about to run. A leading "#" is accepted because that is
// how GitHub writes the number everywhere the developer just read it.
func PlayConfirmationAccepted(answer string, number int) bool {
	typed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(answer), "#"))
	return typed == strconv.Itoa(number)
}

// PlayConfirmationPrompt is the second step's question, naming the exact thing
// to type so the developer is never left guessing at a bare cursor.
func PlayConfirmationPrompt(number int) string {
	return fmt.Sprintf("  Type the PR number (%d) to run it, anything else aborts: ", number)
}

// CollectUntrustedPlayAuthors decides who, if anyone, on this PR is untrusted.
//
// The rule depends on where the head branch lives, because that is what decides
// whether commit metadata means anything:
//
//   - Same-repo PR. The branch exists inside this repository, which required
//     push access to create, so the code has already passed a real access check.
//     Commit identities are checked for write access as before.
//
//   - Fork PR. Everything about the fork's commits — including the account
//     GitHub attributes them to — is chosen by whoever opened the PR. Setting
//     `user.email` to a maintainer's publicly-derivable noreply address is enough
//     to make `author.login` report that maintainer, so attribution alone would
//     let any stranger's code run unprompted. On a fork we therefore trust only
//     commits carrying a signature GitHub verified, and only when the verified
//     signer has write access. Every other commit is named as untrusted.
//
// A permission lookup that fails (404, no access, network) counts as untrusted -
// the gate fails closed.
func CollectUntrustedPlayAuthors(ctx context.Context, repoRoot string, number int, isCrossRepository bool) ([]string, error) {
	commits, err := playPRCommits(ctx, repoRoot, number)
	if err != nil {
		return nil, err
	}
	hasWrite := func(login string) bool {
		perm, permErr := collaboratorPermission(ctx, repoRoot, login)
		return permErr == nil && PermissionGrantsWrite(perm)
	}
	if isCrossRepository {
		return untrustedForkCommits(commits, hasWrite), nil
	}
	return UntrustedPlayAuthors(playIdentitiesFromCommits(commits), hasWrite), nil
}

// untrustedForkCommits names every commit on a fork PR that is not provably the
// work of someone with write access. Unsigned commits are listed individually by
// sha, because on a fork that is the only stable thing to point at - the names
// and emails attached to them are attacker-supplied.
func untrustedForkCommits(commits []ghPRCommit, hasWrite func(login string) bool) []string {
	verdictFor := map[string]bool{}
	var out []string
	seen := map[string]bool{}
	for _, c := range commits {
		signer := c.verifiedSigner()
		if signer != "" {
			trusted, known := verdictFor[strings.ToLower(signer)]
			if !known {
				trusted = hasWrite(signer)
				verdictFor[strings.ToLower(signer)] = trusted
			}
			if trusted {
				continue
			}
			label := fmt.Sprintf("%s (signed by %s, who has no write access)", c.shortSHA(), signer)
			if !seen[label] {
				seen[label] = true
				out = append(out, label)
			}
			continue
		}
		who := strings.TrimSpace(c.Commit.Author.Name)
		if who == "" {
			who = strings.TrimSpace(c.Commit.Author.Email)
		}
		label := fmt.Sprintf("%s (unsigned commit from a fork, attributed to %q)", c.shortSHA(), who)
		if !seen[label] {
			seen[label] = true
			out = append(out, label)
		}
	}
	sort.Strings(out)
	return out
}

// playPRCommitsAPICap is GitHub's hard ceiling on pulls/N/commits: it returns at
// most 250 commits however you paginate, and silently returns the OLDEST ones -
// so the head commit, the one actually checked out and run, is exactly what a
// truncated listing omits.
const playPRCommitsAPICap = 250

// playPRCommits fetches every commit on the PR. `gh api --paginate` emits one
// JSON array per page back to back, so decode arrays until the stream ends.
//
// It fails closed on truncation rather than gating on a partial view: a listing
// that stops at the API cap has not shown us the commits that matter most.
func playPRCommits(ctx context.Context, repoRoot string, number int) ([]ghPRCommit, error) {
	cmd := exec.CommandContext(ctx, "gh", "api", "--paginate",
		fmt.Sprintf("repos/{owner}/{repo}/pulls/%d/commits", number))
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("could not read PR #%d's commits via gh%s", number, gitStderrHint(err))
	}
	var all []ghPRCommit
	dec := json.NewDecoder(strings.NewReader(string(out)))
	for dec.More() {
		var page []ghPRCommit
		if err := dec.Decode(&page); err != nil {
			return nil, fmt.Errorf("unexpected gh output for PR #%d's commits: %w", number, err)
		}
		all = append(all, page...)
	}
	if err := errIfCommitListingTruncated(number, len(all)); err != nil {
		return nil, err
	}
	return all, nil
}

// errIfCommitListingTruncated fails closed when the listing reached GitHub's
// cap. A truncated page set is not a smaller PR: it is the same PR with its
// newest commits — the ones that actually get checked out — withheld, so
// gating on what came back would vouch for code nobody looked at.
func errIfCommitListingTruncated(number, got int) error {
	if got < playPRCommitsAPICap {
		return nil
	}
	return fmt.Errorf(
		"PR #%d has at least %d commits, which is GitHub's listing cap for this endpoint — "+
			"haven cannot see the newest commits, so it cannot vouch for what it would run.\n"+
			"Review it by hand, or re-run with --allow-untrusted to accept that explicitly.",
		number, playPRCommitsAPICap)
}

// collaboratorPermission asks GitHub what access a login has on this repo.
func collaboratorPermission(ctx context.Context, repoRoot, login string) (string, error) {
	cmd := exec.CommandContext(ctx, "gh", "api",
		"repos/{owner}/{repo}/collaborators/"+login+"/permission",
		"--jq", ".permission")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// --- sandbox naming ---
// Every name is derived from the PR number with a play-specific prefix, so a
// sandbox can never collide with the shared servers, the shared compose
// volumes (langwatch-db-data and friends), a real worktree's slug, or a
// `haven pr` checkout (slug pr-<n>, branch haven-pr-<n>). play_test.go pins
// the disjointness.

// PlaySlug is the sandbox's hostname slug: app.play-<n>.langwatch.localhost.
// Deliberately NOT pr-<n> - `haven pr` checkouts already own that slug, and a
// play sandbox of the same PR must be able to coexist with one.
func PlaySlug(number int) string { return fmt.Sprintf("play-%d", number) }

// PlayBranch is the local branch the PR head is fetched into - namespaced away
// from both real branches and haven pr's haven-pr-<n>.
func PlayBranch(number int) string { return fmt.Sprintf("haven-play-%d", number) }

// PlayCheckoutDir is where the sandbox's git worktree lives: under the haven
// home, never among the developer's own worktrees.
func PlayCheckoutDir(home string, number int) string {
	return filepath.Join(home, "play", fmt.Sprintf("pr-%d", number))
}

// PlayCheckoutContained reports whether a recorded checkout path lives inside
// the haven home's play area. Teardown deletes the checkout recursively on the
// word of a JSON record; a corrupt or hand-edited record must never be able to
// aim that deletion anywhere else.
func PlayCheckoutContained(home, checkout string) bool {
	if home == "" || checkout == "" {
		return false
	}
	root := filepath.Clean(filepath.Join(home, "play"))
	cleaned := filepath.Clean(checkout)
	// Strictly inside: the area itself holds every sandbox and is never a
	// valid single-sandbox checkout.
	return cleaned != root &&
		strings.HasPrefix(cleaned+string(filepath.Separator), root+string(filepath.Separator))
}

// playEngines are the sandbox's dedicated backing services, in start order.
var playEngines = []string{"postgres", "clickhouse", "redis"}

// PlayContainerName is a sandbox container's docker name.
func PlayContainerName(number int, engine string) string {
	return fmt.Sprintf("haven-play-%d-%s", number, engine)
}

// PlayVolumeName is a sandbox volume's docker name.
func PlayVolumeName(number int, engine string) string {
	return PlayContainerName(number, engine) + "-data"
}

// playImages pins the sandbox container images. ClickHouse reuses the exact
// image the shared managed server runs; Postgres matches the major version the
// repo targets; Redis is the plain upstream image.
const (
	playPostgresImage = "postgres:16"
	playRedisImage    = "redis:7"
)

// playPostgresShell starts the sandbox's dedicated Postgres and waits for it
// to answer. The host port is a freshly allocated loopback port - never the
// shared server's 5432. Credentials match the overlay's DATABASE_URL shape
// (domain.PostgresRole), so OverlayEnv needs no play-specific case.
func playPostgresShell(number, hostPort int, database string) string {
	name, vol := PlayContainerName(number, "postgres"), PlayVolumeName(number, "postgres")
	return fmt.Sprintf(
		"docker rm -f %s >/dev/null 2>&1 || true\n"+
			"docker run -d --name %s -v %s:/var/lib/postgresql/data -p 127.0.0.1:%d:5432 "+
			"-e POSTGRES_USER=%s -e POSTGRES_PASSWORD=%s -e POSTGRES_DB=%s %s\n"+
			"for i in $(seq 1 60); do docker exec %s pg_isready -U %s -d %s >/dev/null 2>&1 && exit 0; sleep 1; done\n"+
			"echo 'play postgres did not become ready' >&2; exit 1",
		name, name, vol, hostPort,
		domain.PostgresRole, domain.PostgresRolePassword, database, playPostgresImage,
		name, domain.PostgresRole, database)
}

// playClickHouseShell starts the sandbox's dedicated ClickHouse (same pinned
// image and credentials as the shared managed server, its own volume and
// port) and waits for /ping.
func playClickHouseShell(number, hostPort int, database string) string {
	name, vol := PlayContainerName(number, "clickhouse"), PlayVolumeName(number, "clickhouse")
	return fmt.Sprintf(
		"docker rm -f %s >/dev/null 2>&1 || true\n"+
			"docker run -d --name %s -v %s:/var/lib/clickhouse -p 127.0.0.1:%d:8123 "+
			"-e CLICKHOUSE_USER=%s -e CLICKHOUSE_PASSWORD=%s -e CLICKHOUSE_DB=%s "+
			"--memory=1536m --memory-swap=1536m %s\n"+
			"for i in $(seq 1 60); do curl -fsS http://127.0.0.1:%d/ping >/dev/null 2>&1 && exit 0; sleep 1; done\n"+
			"echo 'play clickhouse did not become ready' >&2; exit 1",
		name, name, vol, hostPort,
		domain.ClickHouseUser, domain.ClickHousePassword, database, domain.ClickHouseImage,
		hostPort)
}

// playRedisShell starts the sandbox's dedicated Redis on its own allocated
// port - never the shared singleton on 6379.
func playRedisShell(number, hostPort int) string {
	name, vol := PlayContainerName(number, "redis"), PlayVolumeName(number, "redis")
	return fmt.Sprintf(
		"docker rm -f %s >/dev/null 2>&1 || true\n"+
			"docker run -d --name %s -v %s:/data -p 127.0.0.1:%d:6379 %s\n"+
			"for i in $(seq 1 30); do docker exec %s redis-cli ping 2>/dev/null | grep -q PONG && exit 0; sleep 1; done\n"+
			"echo 'play redis did not become ready' >&2; exit 1",
		name, name, vol, hostPort, playRedisImage, name)
}

// --- the sandbox record ---
// Written BEFORE any resource is created, so a play that dies hard is always
// discoverable: `haven clean` reads these records and finishes the teardown
// for any whose owner process is gone.

// PlayRecord is one sandbox's on-disk record (<home>/play/pr-<n>.json).
type PlayRecord struct {
	Number    int       `json:"number"`
	Slug      string    `json:"slug"`
	PID       int       `json:"pid"` // the process that owns the sandbox's lifecycle
	Checkout  string    `json:"checkout"`
	RepoRoot  string    `json:"repoRoot"` // the primary checkout teardown runs git against
	CreatedAt time.Time `json:"createdAt"`
}

func playRecordPath(home string, number int) string {
	return filepath.Join(home, "play", fmt.Sprintf("pr-%d.json", number))
}

// WritePlayRecord persists (or refreshes) a sandbox record.
func WritePlayRecord(home string, rec PlayRecord) error {
	if err := os.MkdirAll(filepath.Join(home, "play"), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(playRecordPath(home, rec.Number), append(b, '\n'), 0o644)
}

// ReadPlayRecords loads every sandbox record under the haven home.
func ReadPlayRecords(home string) []PlayRecord {
	var out []PlayRecord
	entries, err := os.ReadDir(filepath.Join(home, "play"))
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(home, "play", e.Name()))
		if err != nil {
			continue
		}
		var rec PlayRecord
		if json.Unmarshal(b, &rec) == nil && rec.Number > 0 {
			out = append(out, rec)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Number < out[j].Number })
	return out
}

// RemovePlayRecord drops a sandbox record.
func RemovePlayRecord(home string, number int) { _ = os.Remove(playRecordPath(home, number)) }

// PlaysToReap picks the sandboxes whose owner process is gone - the ones a
// crash left behind. A record whose owner is still alive belongs to a running
// play and is never touched.
func PlaysToReap(recs []PlayRecord, alive func(pid int) bool) []PlayRecord {
	var out []PlayRecord
	for _, rec := range recs {
		if rec.PID != 0 && alive(rec.PID) {
			continue
		}
		out = append(out, rec)
	}
	return out
}

// --- teardown ---
// The defining contract of play: quitting ALWAYS destroys everything, in a
// fixed order (stop what runs, then unroute, then remove state), and a failing
// step never stops the steps after it - a wedged docker daemon must not leave
// the checkout behind too.

// PlayTeardownHooks are the effects the teardown plan runs, injectable so the
// ordering and best-effort behaviour are unit-testable without docker or git.
type PlayTeardownHooks struct {
	StopProcesses    func() error // kill the sandbox's supervised process group
	RemoveRoutes     func() error // deregister the play hostnames from the proxy
	RemoveContainers func() error // docker rm -f the play containers
	RemoveVolumes    func() error // docker volume rm the play volumes (the data)
	RemoveCheckout   func() error // remove the git worktree + play branch
	RemoveRecord     func() error // drop the sandbox record + registry entry
}

// playStep is one named teardown step.
type playStep struct {
	name string
	run  func() error
	// onlyIfClean marks a step that must be skipped when an earlier step failed.
	// The record is the only such step: it is what makes a sandbox findable, so
	// removing it after a failed teardown strands whatever survived — containers,
	// volumes, a checkout — with nothing left to reap them.
	onlyIfClean bool
}

// playTeardownPlan fixes the teardown order. Processes first (nothing may hold
// the databases), then routes (the hostname must not point at a corpse), then
// containers before their volumes (docker refuses to remove a volume in use),
// then the checkout, then the record last - so a half-finished teardown is
// still discoverable and re-runnable by `haven clean`.
func playTeardownPlan(h PlayTeardownHooks) []playStep {
	return []playStep{
		{name: "stop processes", run: h.StopProcesses},
		{name: "remove routes", run: h.RemoveRoutes},
		{name: "remove containers", run: h.RemoveContainers},
		{name: "remove volumes", run: h.RemoveVolumes},
		{name: "remove checkout", run: h.RemoveCheckout},
		{name: "remove record", run: h.RemoveRecord, onlyIfClean: true},
	}
}

// runPlayTeardown executes the steps in order, best-effort: a failure is
// reported and joined into the returned error, never a reason to stop the
// remaining steps. The one exception is a step marked onlyIfClean, which is
// skipped once anything has failed — see playStep.
func runPlayTeardown(steps []playStep, report func(step string, err error)) error {
	var errs []error
	for _, s := range steps {
		if s.run == nil {
			continue
		}
		if s.onlyIfClean && len(errs) > 0 {
			if report != nil {
				report(s.name+" (kept: teardown was incomplete, so `haven clean` can finish it)", nil)
			}
			continue
		}
		err := s.run()
		if report != nil {
			report(s.name, err)
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", s.name, err))
		}
	}
	return errors.Join(errs...)
}

// PlayTeardown destroys one sandbox completely: processes, hostnames,
// containers, volumes, checkout, record. Idempotent - every step tolerates
// the resource already being gone, so `haven clean` can finish a teardown a
// crash interrupted.
func (o *Orchestrator) PlayTeardown(ctx context.Context, rec PlayRecord) error {
	hooks := PlayTeardownHooks{
		StopProcesses: func() error {
			if rec.PID == 0 || rec.PID == o.sys.Getpid() || !o.sys.ProcessAlive(rec.PID) {
				return nil
			}
			o.sys.KillGroup(rec.PID)
			o.waitForProcessesDead([]int{rec.PID})
			return nil
		},
		RemoveRoutes: func() error {
			for _, r := range domain.PerWorktreeServices {
				o.proxy.Remove(r.Name, rec.Slug)
			}
			o.proxy.Remove(domain.ClickHouseService, rec.Slug)
			return nil
		},
		// No `|| true` on either of these. `rm -f` and `volume rm -f` already
		// succeed on names that do not exist, so swallowing the exit status buys
		// no idempotency — it only hides the failures that matter (a volume still
		// held by a container, a docker daemon that is not running) and reports a
		// clean teardown while the sandbox's data is still on disk.
		RemoveContainers: func() error {
			return o.playDocker(ctx, rec.Checkout, "play-rm",
				"docker rm -f "+strings.Join(playContainerNames(rec.Number), " ")+" >/dev/null")
		},
		RemoveVolumes: func() error {
			return o.playDocker(ctx, rec.Checkout, "play-rm-volumes",
				"docker volume rm -f "+strings.Join(playVolumeNames(rec.Number), " ")+" >/dev/null")
		},
		RemoveCheckout: func() error {
			if !PlayCheckoutContained(o.cfg.Home, rec.Checkout) {
				return fmt.Errorf("refusing to remove %q: outside the play area %q", rec.Checkout, filepath.Join(o.cfg.Home, "play"))
			}
			return removePlayCheckout(ctx, rec.RepoRoot, rec.Checkout, PlayBranch(rec.Number))
		},
		RemoveRecord: func() error {
			o.store.RemoveStack(rec.Slug)
			RemovePlayRecord(o.cfg.Home, rec.Number)
			return nil
		},
	}
	return runPlayTeardown(playTeardownPlan(hooks), func(step string, err error) {
		if err != nil {
			fmt.Printf("  play teardown: %s failed: %v\n", step, err)
			return
		}
		fmt.Printf("  play teardown: %s\n", step)
	})
}

func playContainerNames(number int) []string {
	names := make([]string, len(playEngines))
	for i, e := range playEngines {
		names[i] = PlayContainerName(number, e)
	}
	return names
}

func playVolumeNames(number int) []string {
	names := make([]string, len(playEngines))
	for i, e := range playEngines {
		names[i] = PlayVolumeName(number, e)
	}
	return names
}

// playDocker runs a docker shell against the colima runtime's socket.
func (o *Orchestrator) playDocker(ctx context.Context, dir, lane, shell string) error {
	if o.container == nil {
		return fmt.Errorf("no container runtime configured")
	}
	dockerHost, err := o.container.Ensure(ctx)
	if err != nil {
		return fmt.Errorf("colima (%s): %w", o.container.Profile(), err)
	}
	if dir == "" || !isDir(dir) {
		dir = o.cfg.Home
	}
	return o.sup.RunOnce(ctx, lane, dir, shell, []string{"DOCKER_HOST=" + dockerHost})
}

// removePlayCheckout removes the sandbox's git worktree and its play branch.
// Best-effort at every stage: a checkout that is already gone (or whose repo
// is) must not block the rest of the teardown, and a stubborn directory is
// removed directly as the fallback.
func removePlayCheckout(ctx context.Context, repoRoot, checkout, branch string) error {
	if checkout == "" {
		return nil
	}
	if isDir(checkout) {
		if err := runQuiet(ctx, repoRoot, "git", "worktree", "remove", "--force", checkout); err != nil {
			// The admin entry may be gone or the dir wedged: remove the directory
			// itself and let `git worktree prune` collect the entry.
			if rmErr := os.RemoveAll(checkout); rmErr != nil {
				return errors.Join(err, rmErr)
			}
		}
	}
	_ = runQuiet(ctx, repoRoot, "git", "worktree", "prune")
	_ = runQuiet(ctx, repoRoot, "git", "branch", "-D", branch)
	return nil
}

// runQuiet runs a child discarding its output - teardown plumbing whose
// failure modes are reported by the step runner, not streamed.
func runQuiet(ctx context.Context, dir, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	return cmd.Run()
}

// ReapOrphanPlays finishes the teardown of every sandbox whose owner process
// is gone - the `haven clean` tail for plays that died hard. Returns how many
// were reaped.
func (o *Orchestrator) ReapOrphanPlays(ctx context.Context) (int, error) {
	orphans := PlaysToReap(ReadPlayRecords(o.cfg.Home), o.sys.ProcessAlive)
	var errs []error
	for _, rec := range orphans {
		fmt.Printf("reaping play sandbox pr-%d (owner process gone)\n", rec.Number)
		if err := o.PlayTeardown(ctx, rec); err != nil {
			errs = append(errs, err)
		}
	}
	return len(orphans), errors.Join(errs...)
}

// OrphanPlays lists the sandboxes whose owner process is gone, without
// touching them - the read-only view `haven clean` shows agents.
func (o *Orchestrator) OrphanPlays() []PlayRecord {
	return PlaysToReap(ReadPlayRecords(o.cfg.Home), o.sys.ProcessAlive)
}

// EnsurePlayCheckout creates (or refreshes) the sandbox's git worktree at the
// PR's current head, reusing the same fetch/refresh machinery as `haven pr`.
func EnsurePlayCheckout(ctx context.Context, repoRoot string, number int, checkout string) error {
	if isDir(checkout) {
		fmt.Printf("↺ reusing play checkout %s: refreshing to PR head\n", checkout)
		// The sandbox is ephemeral by contract, so local edits are discarded, not
		// stashed - nothing in a play checkout is ever the developer's own work.
		if err := refreshPRWorktree(ctx, checkout, number, true); err != nil {
			return err
		}
		return StripInheritedEnvFiles(checkout)
	}
	fmt.Printf("→ PR #%d → %s\n", number, checkout)
	if err := ensurePRWorktree(ctx, repoRoot, number, PlayBranch(number), checkout, false); err != nil {
		return err
	}
	// Belt and braces over disabling the hook: the sweep also covers a refresh, a
	// checkout left behind by an older haven, and any future hook that copies
	// secrets in by another route.
	return StripInheritedEnvFiles(checkout)
}

// playEnvDirs mirrors the directories .githooks/post-checkout copies .env files
// into, plus the repo root.
var playEnvDirs = []string{".", "langwatch", "langwatch_nlp", "langevals", "python-sdk", "typescript-sdk", "mcp-server"}

// StripInheritedEnvFiles removes every untracked .env* file from a play checkout.
//
// A sandbox runs code nobody has reviewed. The developer's .env files carry live
// provider keys, Stripe and auth secrets, and shared-dev connection strings that
// the stack's own overlay never supplies, so inheriting them would hand all of it
// to the PR — while the sandbox banner promises nothing is shared. Tracked files
// (.env.example and friends) are part of the tree and stay.
func StripInheritedEnvFiles(checkout string) error {
	for _, dir := range playEnvDirs {
		matches, err := filepath.Glob(filepath.Join(checkout, dir, ".env*"))
		if err != nil {
			return fmt.Errorf("scanning %s for inherited env files: %w", dir, err)
		}
		for _, path := range matches {
			info, statErr := os.Stat(path)
			if statErr != nil || info.IsDir() {
				continue
			}
			rel, relErr := filepath.Rel(checkout, path)
			if relErr != nil || gitTracksFile(checkout, rel) {
				continue
			}
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("removing inherited %s from the play sandbox: %w", rel, err)
			}
		}
	}
	return nil
}

// gitTracksFile reports whether the checkout tracks this path. Untracked .env
// files are the developer's own; tracked ones are the repo's.
func gitTracksFile(checkout, rel string) bool {
	cmd := exec.Command("git", "-C", checkout, "ls-files", "--error-unmatch", rel)
	return cmd.Run() == nil
}

// PlayDisclosure is the upfront data-loss disclosure `haven play` prints
// before creating anything - the sandbox's contract in one banner.
func PlayDisclosure(number int) string {
	return fmt.Sprintf(
		"haven play pr-%d: an EPHEMERAL sandbox.\n"+
			"  Everything it creates is destroyed when you quit the view (q) or the process exits:\n"+
			"  databases and their volumes, containers, the checkout, and the hostname.\n"+
			"  It gets its own databases and hostnames, and none of your .env files.\n"+
			"  It still runs the PR's code on this machine, as you.\n",
		number)
}

// PlayLaunch provisions and supervises one sandbox in the current process:
// dedicated containers, play hostnames, overlay, dependency install,
// migrations, seed, then the supervised service set until ctx is cancelled.
// It never cleans up - the owning `haven play` process (or `haven clean`)
// owns the teardown, so a hard death here can never skip it.
func (o *Orchestrator) PlayLaunch(ctx context.Context, number int, checkout, lwDir string) error {
	slug := PlaySlug(number)
	database := domain.DatabaseForSlug(slug)
	fmt.Print(PlayDisclosure(number))

	if !o.proxy.Installed() {
		fmt.Println("portless is not installed: installing it (one time)…")
		if err := o.proxy.Install(); err != nil {
			return fmt.Errorf("could not install portless automatically (%w)", err)
		}
	}
	if err := o.proxy.EnsureReady(); err != nil {
		return fmt.Errorf("could not start the portless proxy: %w", err)
	}
	if o.container == nil {
		return fmt.Errorf("haven play needs the container runtime (colima) for its dedicated databases")
	}
	dockerHost, err := o.container.Ensure(ctx)
	if err != nil {
		return fmt.Errorf("colima (%s): %w", o.container.Profile(), err)
	}

	nSvc := len(domain.PerWorktreeServices)
	ports, err := o.sys.FreePorts(nSvc + 5)
	if err != nil {
		return err
	}
	pgPort, chPort, redisPort := ports[nSvc+2], ports[nSvc+3], ports[nSvc+4]

	// Dedicated infra first: the overlay needs the ports, migrations need the
	// databases. Each engine is its own lane so its output reads distinctly.
	dockerEnv := []string{"DOCKER_HOST=" + dockerHost}
	fmt.Printf("  play: starting dedicated postgres/clickhouse/redis (volumes %s…)\n", PlayVolumeName(number, "postgres"))
	if err := o.sup.RunOnce(ctx, "play-postgres", checkout, playPostgresShell(number, pgPort, database), dockerEnv); err != nil {
		return fmt.Errorf("play postgres: %w", err)
	}
	if err := o.sup.RunOnce(ctx, "play-clickhouse", checkout, playClickHouseShell(number, chPort, database), dockerEnv); err != nil {
		return fmt.Errorf("play clickhouse: %w", err)
	}
	if err := o.sup.RunOnce(ctx, "play-redis", checkout, playRedisShell(number, redisPort), dockerEnv); err != nil {
		return fmt.Errorf("play redis: %w", err)
	}

	scheme, pport := o.proxy.Endpoint()
	sel := domain.Selection{Gateway: true, NLP: true} // lean default; langy never runs in a sandbox
	st := domain.Stack{
		Slug: slug, WorktreeDir: checkout, Branch: PlayBranch(number),
		LauncherPID: o.sys.Getpid(),
		// The sandbox's Redis is dedicated, so index 0 is always free.
		RedisDB:            0,
		APIPort:            ports[nSvc],
		WorkerMetricsPort:  ports[nSvc+1],
		LocalAPIKey:        o.cfg.LocalAPIKey,
		ClickHouseHTTPPort: chPort, ClickHouseDatabase: database,
		PostgresPort: pgPort, PostgresDatabase: database,
		RedisPort: redisPort,
	}
	for i, r := range domain.PerWorktreeServices {
		svc := domain.Service{
			Name: r.Name, Role: r.Role, Port: ports[i],
			Hostname: o.cfg.Naming.Hostname(r.Name, slug),
			URL:      o.cfg.Naming.URL(r.Name, slug, scheme, pport),
		}
		// The sandbox is hermetic: a service it does not run (langy) gets no
		// baseline fallback - its port is simply absent.
		if !runsLocally(r.Name, PlanOptions{Selection: sel}) {
			svc.Port = 0
		}
		st.Services = append(st.Services, svc)
		if svc.Port != 0 {
			if err := o.proxy.Register(svc.Name, slug, svc.Port); err != nil {
				return fmt.Errorf("registering %s.%s: %w", svc.Name, slug, err)
			}
		}
	}
	if err := o.proxy.Register(domain.ClickHouseService, slug, chPort); err != nil {
		o.log.Warn("play clickhouse alias registration failed")
	}
	st.UpdatedAt = o.sys.Now()
	if err := o.store.WriteOverlay(lwDir, st); err != nil {
		return err
	}
	if err := o.store.SaveStack(st); err != nil {
		return err
	}
	o.printStack(st)

	// A sandbox exists to run somebody else's PR, so its package scripts are
	// never trusted — install without lifecycle scripts unconditionally rather
	// than re-deriving fork status inside this detached child. Nothing is lost:
	// the repo's postinstall is codegen, and the very next step runs it
	// explicitly through start:prepare:files.
	if err := o.ensureDeps(ctx, checkout, false); err != nil {
		return err
	}
	env := append(st.OverlayEnv(), "DOTENV_CONFIG_QUIET=true")
	if err := o.sup.RunOnce(ctx, "codegen", lwDir, "pnpm -s run start:prepare:files", env); err != nil {
		o.log.Warn("play codegen failed (continuing)")
	}
	if err := o.sup.RunOnce(ctx, "prepare", lwDir, "pnpm -s run start:prepare:db", env); err != nil {
		return fmt.Errorf("play migrations failed: %w", err)
	}
	if err := o.sup.RunOnce(ctx, "seed", lwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
		o.log.Warn("play seed failed (continuing)")
	}
	opts := PlanOptions{Selection: sel, RepoRoot: checkout}
	o.sup.Supervise(ctx, o.planChildren(st, opts, lwDir, ""))
	return nil
}
