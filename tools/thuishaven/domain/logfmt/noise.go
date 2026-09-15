package logfmt

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// Muted reports whether a captured line is a tool's own banner rather than
// anything a person is reading the lane for.
//
// It applies to the ONE-SHOT lanes only — codegen, prepare, seed. Those run a
// package manager and a code generator, and the generators print a preamble
// about their own configuration on every invocation. Prisma 7.9.1 has no flag
// for it: `prisma generate --help` offers `--no-hints` (hint messages only),
// `--schema`, `--config`, `--generator`, `--sql`, `--watch` and
// `--require-models`, and nothing that quiets the two "loaded" lines — one of
// which it writes to stderr. So the lane that runs it drops them.
//
// A long-running service lane is never muted: a blank line there is the shape
// of somebody's output, and a line naming a schema is news.
//
// The capture keeps every line either way. This is only about the live echo,
// so `haven logs --raw` still replays exactly what the child wrote.
func Muted(lane, line string) bool {
	if !oneShotLanes[lane] {
		return false
	}
	trimmed := strings.TrimSpace(stripSGR(line))
	if trimmed == "" {
		return true
	}
	for _, banner := range toolBanners {
		if strings.HasPrefix(trimmed, banner) {
			return true
		}
	}
	return false
}

// oneShotLanes are the lanes that run tools rather than serve traffic.
var oneShotLanes = map[string]bool{"codegen": true, "prepare": true, "seed": true}

// toolBanners are the preambles, matched by prefix because each ends in a path
// that differs per invocation.
var toolBanners = []string{
	"Loaded Prisma config from",
	"Prisma schema loaded from",
}

// sgrEscape matches one SGR colour sequence. Prisma dims its banner, so the
// prefix match has to be about the words and not about how they were painted.
var sgrEscape = regexp.MustCompile("\x1b\\[[0-9;]*m")

// stripSGR removes the colour escapes from a line.
func stripSGR(line string) string {
	return sgrEscape.ReplaceAllString(line, "")
}

// isPassthroughNoise reports whether a non-JSON line carries nothing once its
// own decoration is stripped: plain whitespace, color escapes, or a border a
// tool drew out of box-drawing characters. Unlike Muted, this applies to
// every lane, long-running or one-shot, because a blank or a bare rule adds a
// row to the stream without adding a word anyone reads it for.
func isPassthroughNoise(line string) bool {
	clean := strings.TrimSpace(stripSGR(line))
	if clean == "" {
		return true
	}
	for _, r := range clean {
		if !unicode.IsSpace(r) && !strings.ContainsRune(decorationRunes, r) {
			return false
		}
	}
	return true
}

// decorationRunes are border, rule and bullet characters some tools use to
// frame a banner. None of them is a word, so a line made only of these and
// whitespace carries nothing.
const decorationRunes = "─━│┃┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬▀▄█░▒▓•●○◆◇■□-=_*#~"

// viteReadyLine matches Vite's own startup line, e.g.
// "VITE v8.1.2  ready in 1814 ms", whatever whitespace the child used.
var viteReadyLine = regexp.MustCompile(`(?i)^VITE\s+v(\S+)\s+ready in\s+(.+)$`)

// viteBannerNoise matches the banner lines that follow the ready line: the
// routed addresses - haven already prints the lane's own hostname - and the
// shortcut hint, which means nothing to a process haven supervises.
var viteBannerNoise = regexp.MustCompile(`(?i)^(?:\x{279c}\s*)?(?:local|network):|^(?:\x{279c}\s*)?press h \+ enter to show help$`)

// viteReadyMessage rewrites Vite's own ready line into the single line worth
// reading. ok is false for anything else, including the banner's other lines.
func viteReadyMessage(text string) (string, bool) {
	m := viteReadyLine.FindStringSubmatch(strings.TrimSpace(stripSGR(text)))
	if m == nil {
		return "", false
	}
	return fmt.Sprintf("vite %s ready in %s", m[1], strings.TrimSpace(m[2])), true
}

// isViteBannerNoise reports whether text is one of the banner lines that
// follow Vite's ready line - the addresses and the shortcut hint - rather
// than the ready line itself.
func isViteBannerNoise(text string) bool {
	return viteBannerNoise.MatchString(strings.TrimSpace(stripSGR(text)))
}
