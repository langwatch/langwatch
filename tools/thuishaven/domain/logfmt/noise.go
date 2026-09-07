package logfmt

import (
	"regexp"
	"strings"
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
