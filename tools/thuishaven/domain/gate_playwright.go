package domain

import (
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Where haven is installed, agents drive the UI with `haven browser`: one shared
// headless browser, signed in, answering in page diffs. The gate refuses the
// interactive Playwright doors (its MCP tools, playwright-cli, `playwright open`)
// and never an e2e run (`playwright test`, `pnpm test:e2e`).

// PlaywrightToolMatcher is the PreToolUse matcher alternative for Playwright's MCP
// tools, under any server name a plugin gives them.
const PlaywrightToolMatcher = "mcp__.*playwright.*"

var playwrightTool = regexp.MustCompile(`^` + PlaywrightToolMatcher + `$`)

// playwrightInteractive are the `playwright` subcommands that open a browser for a
// person or an agent to drive; `test`, `install` and `show-report` stay allowed.
var playwrightInteractive = []string{"open", "codegen", "show-trace", "cr", "ff", "wk", "screenshot", "pdf"}

// playwrightLaunchers are the wrappers that run a package binary: `npx playwright`.
var playwrightLaunchers = map[string]int{"npx": 1, "bunx": 1, "pnpx": 1, "dlx": 1}

// PlaywrightRefusal is the deny reason for a tool call that drives a browser by
// Playwright instead of `haven browser`, and whether the call is one.
func PlaywrightRefusal(tool, command string) (string, bool) {
	if len(tool) > 5 && strings.EqualFold(tool[:5], "mcp__") && playwrightTool.MatchString(strings.ToLower(tool)) {
		return playwrightReason(tool), true
	}
	if tool != "Bash" || !mentionsPlaywright(command) {
		return "", false
	}
	for _, segment := range commandSegments(command) {
		if what, ok := playwrightSegment(segment); ok {
			return playwrightReason(what), true
		}
	}
	return "", false
}

// mentionsPlaywright is the cheap test every Bash call passes first: whether the
// command spells "playwright" anywhere, quotes and backslashes skipped as the shell would.
func mentionsPlaywright(command string) bool {
	const word = "playwright"
	matched := 0
	for i := 0; i < len(command); i++ {
		switch c := command[i]; c {
		case '"', '\'', '\\':
		case word[matched]:
			if matched++; matched == len(word) {
				return true
			}
		default:
			matched = 0
			if c == word[0] {
				matched = 1
			}
		}
	}
	return false
}

// playwrightSegment names the interactive Playwright program one shell segment runs.
func playwrightSegment(segment string) (string, bool) {
	words := playwrightProgram(programWords(ShellWords(segment)))
	if len(words) == 0 {
		return "", false
	}
	name := filepath.Base(words[0])
	if name == "playwright-cli" || strings.HasPrefix(words[0], "@playwright/cli") || strings.HasPrefix(words[0], "@playwright/mcp") {
		return words[0], true
	}
	if name == "playwright" && len(words) > 1 && slices.Contains(playwrightInteractive, words[1]) {
		return "playwright " + words[1], true
	}
	return "", false
}

// playwrightProgram drops a launcher prefix (npx, pnpm exec, pnpm dlx, yarn) and its
// flags, so `npx -y playwright open` reads as `playwright open`.
func playwrightProgram(words []string) []string {
	for len(words) > 0 {
		switch {
		case words[0] == "rtk" || words[0] == "yarn":
			words = words[1:]
		case words[0] == "pnpm" && len(words) > 1 && (words[1] == "exec" || words[1] == "dlx"):
			words = stripLeadingFlags(words[2:], false)
		case playwrightLaunchers[filepath.Base(words[0])] > 0:
			words = stripLeadingFlags(words[1:], false)
		default:
			return words
		}
	}
	return words
}

func playwrightReason(what string) string {
	return what + " is refused here: haven is installed, so drive the UI with `haven browser` " +
		"(one shared signed-in browser; actions print what changed; network, console and profile verbs). " +
		"Load the haven-browser skill. E2E runs (playwright test, pnpm test:e2e) are not affected."
}
