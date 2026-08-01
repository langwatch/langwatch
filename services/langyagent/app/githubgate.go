// The GitHub gate: the manager-side detection that stops a turn the moment the
// agent reaches for GitHub without the access to do it — the producer of the
// `langy_github_not_connected` / `langy_github_repo_not_accessible` error codes
// the control plane's explainer renders as the install card / access hint.
//
// The worker's github skill PROMISES the agent this exists ("the platform stops
// the turn the moment you reach for gh…"), and the whole client half — the
// explainer's `suppress` mode, the recovery policy's awaiting-user state, the
// panel's connect card, the post-install re-drive — is keyed to these codes.
// This file is their only emitter.
//
// Detection reads the SETTLED tool frames the adapter already emits (never the
// model's prose): a `bash` call whose command needs GitHub credentials, on a
// turn that carries none, trips the gate; the gate cancels the stream and
// driveTurn emits the vetted error frame. The command grammar mirrors the TS
// recogniser in
// langwatch/src/server/app-layer/langy/execution/githubCommand.ts — keep the
// two in sync.
package app

import (
	"encoding/json"
	"regexp"
	"strings"
	"sync"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// The vetted wire codes this gate emits. They MUST match the cases in the
// control plane's langyAgentErrorFromFrame (langy-turn-errors.ts) — that is the
// classifier that turns them into the typed DomainErrors the client keys on.
const (
	codeGithubNotConnected      = "langy_github_not_connected"
	codeGithubRepoNotAccessible = "langy_github_repo_not_accessible"
)

// githubGate watches the turn's tool frames for the agent reaching for GitHub.
//
//   - No GitHub credential on the turn + a settled GitHub-reaching command ⇒
//     trip `langy_github_not_connected` (the install card, not an error).
//   - Credential present + the command FAILED looking like the repo isn't in
//     the installation (404 / not found) ⇒ trip
//     `langy_github_repo_not_accessible` (point at the installation settings).
//
// On trip it cancels the stream (via the injected cancel), so driveTurn can
// emit the vetted terminal error frame instead of letting the model flounder
// in prose. Observe is called from the stream goroutine; Tripped from
// driveTurn — hence the mutex. Trips at most once.
type githubGate struct {
	hasCredential bool
	cancel        func()

	mu      sync.Mutex
	tripped bool
	code    string
	message string
}

func newGithubGate(hasCredential bool, cancel func()) *githubGate {
	return &githubGate{hasCredential: hasCredential, cancel: cancel}
}

// gateToolFrame is the slice of the frames-union `tool` frame the gate reads.
// The end frame is self-describing (input rides it too), so the settle event
// alone answers "what ran, and how did it end?".
type gateToolFrame struct {
	Type  string `json:"type"`
	Phase string `json:"phase"`
	Input struct {
		Command string `json:"command"`
	} `json:"input"`
	Output  string `json:"output"`
	IsError *bool  `json:"isError"`
}

// Observe inspects one emitted frame. Inspect-only from the sink's point of
// view — it never blocks or fails the emit; a trip is surfaced by cancelling
// the stream and answering Tripped().
func (g *githubGate) Observe(f frames.Frame) {
	g.mu.Lock()
	already := g.tripped
	g.mu.Unlock()
	if already {
		return
	}

	var tf gateToolFrame
	if err := json.Unmarshal([]byte(f.JSON()), &tf); err != nil {
		return
	}
	if tf.Type != "tool" || tf.Phase != "end" || tf.Input.Command == "" {
		return
	}
	if !commandNeedsGithubAuth(tf.Input.Command) {
		return
	}

	if !g.hasCredential {
		g.trip(codeGithubNotConnected,
			"the agent needs GitHub access, but the LangWatch GitHub App is not installed for this organization")
		return
	}
	isError := tf.IsError != nil && *tf.IsError
	if isError && outputLooksRepoNotAccessible(tf.Output) {
		g.trip(codeGithubRepoNotAccessible,
			"the repository is not available to the LangWatch GitHub App")
	}
}

func (g *githubGate) trip(code, message string) {
	g.mu.Lock()
	if g.tripped {
		g.mu.Unlock()
		return
	}
	g.tripped = true
	g.code = code
	g.message = message
	g.mu.Unlock()
	if g.cancel != nil {
		g.cancel()
	}
}

// Tripped reports whether the gate fired, and with what vetted code + message.
func (g *githubGate) Tripped() (message, code string, ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.message, g.code, g.tripped
}

// outputLooksRepoNotAccessible classifies a FAILED GitHub-reaching command's
// output as "the app cannot see that repository". Only consulted when a
// credential was present and the call errored, so the match can be broad: a 404
// from gh/git on a repo the installation doesn't cover is the dominant cause.
func outputLooksRepoNotAccessible(output string) bool {
	o := strings.ToLower(output)
	return strings.Contains(o, "404") ||
		strings.Contains(o, "not found") ||
		strings.Contains(o, "could not resolve to a repository")
}

// --- the command grammar (port of githubCommand.ts, keep in sync) -----------

// networkGitSubcommands are the `git` subcommands that talk to the remote (and
// so need the token). Everything else `git` does is local and must NOT trip the
// gate — a turn that only commits locally is fine without GitHub.
var networkGitSubcommands = map[string]struct{}{
	"clone": {}, "push": {}, "fetch": {}, "pull": {}, "ls-remote": {},
}

// commandNeedsGithubAuth reports whether the shell command reaches for GitHub:
// any `gh` invocation (the CLI always authenticates with GH_TOKEN), or a `git`
// subcommand that talks to the remote through the credential helper.
func commandNeedsGithubAuth(command string) bool {
	for _, tokens := range commandSegments(command) {
		if len(tokens) == 0 {
			continue
		}
		if tokens[0] == "gh" {
			return true
		}
		if tokens[0] == "git" && isNetworkGit(tokens[1:]) {
			return true
		}
	}
	return false
}

func isNetworkGit(rest []string) bool {
	// Skip `git -C /path push` style global flags to find the subcommand;
	// `-C <path>` and `-c <cfg>` take a value, so skip that too.
	for i := 0; i < len(rest); i++ {
		token := rest[i]
		if strings.HasPrefix(token, "-") {
			if token == "-C" || token == "-c" {
				i++
			}
			continue
		}
		_, ok := networkGitSubcommands[token]
		return ok
	}
	return false
}

// segmentSplit splits a compound shell command into its individual invocations:
// `&&`, `||`, `;`, `|`, newlines, and `$(…)`/backtick openings all start a new
// segment. A RECOGNISER, not a shell — it over-splits rather than under-splits
// (missing a `gh` costs a turn dying on a confusing auth error; an extra split
// costs nothing). Mirrors commandSegments in githubCommand.ts.
var segmentSplit = regexp.MustCompile(`\|\||&&|[;\n|]|\$\(|` + "`" + `|\)`)

// inlineEnvAssign matches a leading `FOO=bar` env prefix on an invocation.
var inlineEnvAssign = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=`)

func commandSegments(command string) [][]string {
	var segments [][]string
	for _, segment := range segmentSplit.Split(command, -1) {
		tokens := tokenizeSegment(segment)
		if len(tokens) > 0 {
			segments = append(segments, tokens)
		}
	}
	return segments
}

func tokenizeSegment(segment string) []string {
	fields := strings.Fields(strings.TrimSpace(segment))
	tokens := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.Trim(f, `"'`)
		if f != "" {
			tokens = append(tokens, f)
		}
	}
	// `FOO=bar gh pr create` — step past inline env assignments to the real argv0.
	start := 0
	for start < len(tokens) && inlineEnvAssign.MatchString(tokens[start]) {
		start++
	}
	return tokens[start:]
}
