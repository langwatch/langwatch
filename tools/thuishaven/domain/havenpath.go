package domain

import (
	"path/filepath"
	"strings"
)

// Being able to RUN haven is the prerequisite none of the others can express.
// `go install` drops the binary in the Go bin dir; if that directory is not
// on PATH, the freshly installed `haven` resolves to nothing and the "now
// just run haven" promise is broken at the exact moment it is made.
//
// This file is the pure half: which rc file a shell reads, what line to put
// in it, and what the situation actually is. Reading the environment and
// writing the file belong to the app layer.

// ShellKind is the shells haven knows how to configure. Anything else is not
// guessed at — appending an `export` to the config of a shell that does not
// take one is worse than saying so.
type ShellKind int

const (
	ShellUnknown ShellKind = iota
	ShellZsh
	ShellBash
	ShellFish
)

// ShellKindOf classifies a $SHELL path by its base name.
func ShellKindOf(shellPath string) ShellKind {
	switch filepath.Base(shellPath) {
	case "zsh":
		return ShellZsh
	case "bash":
		return ShellBash
	case "fish":
		return ShellFish
	default:
		return ShellUnknown
	}
}

// ShellRCPaths is where each shell keeps the config a login shell reads.
// home is $HOME; zdotdir and xdgConfig are the overrides their shells honour,
// empty when unset.
func ShellRCPath(kind ShellKind, home, zdotdir, xdgConfig string) string {
	switch kind {
	case ShellZsh:
		if zdotdir != "" {
			return filepath.Join(zdotdir, ".zshrc")
		}
		return filepath.Join(home, ".zshrc")
	case ShellBash:
		return filepath.Join(home, ".bashrc")
	case ShellFish:
		if xdgConfig == "" {
			xdgConfig = filepath.Join(home, ".config")
		}
		return filepath.Join(xdgConfig, "fish", "config.fish")
	default:
		// Unknown shell: no file, because haven does not know its syntax and
		// a wrong line in a shell's config breaks every new terminal.
		return ""
	}
}

// ShellPathLine is the line that puts dir on PATH, in that shell's own
// syntax. fish has no `export`, and writing one into config.fish produces a
// shell that errors on every launch.
func ShellPathLine(kind ShellKind, dir string) string {
	if kind == ShellFish {
		return "fish_add_path " + dir
	}
	return `export PATH="` + dir + `:$PATH"`
}

// PathContains reports whether dir is an entry of a $PATH value. Entry, not
// substring: /usr/local/bin must not match /usr/local/bin-other.
func PathContains(pathEnv, dir string) bool {
	if dir == "" {
		return false
	}
	for _, entry := range strings.Split(pathEnv, ":") {
		if entry == dir {
			return true
		}
	}
	return false
}

// HavenPathState is the situation, once everything has been looked at.
type HavenPathState int

const (
	// HavenPathReady: the Go bin dir is on PATH and `haven` resolves.
	HavenPathReady HavenPathState = iota
	// HavenPathPending: not on PATH yet, but the rc file already carries the
	// line — so a new shell will have it. Adding it again would duplicate.
	HavenPathPending
	// HavenPathOfferable: not on PATH, and haven knows which file to add it
	// to. The only state where there is anything to ask.
	HavenPathOfferable
	// HavenPathManual: not on PATH, and haven does not know this shell well
	// enough to edit its config. Print the line and stop.
	HavenPathManual
)

// HavenPathFacts is what the app layer measured.
type HavenPathFacts struct {
	// BinDir is where `go install` puts the binary (GOBIN, else GOPATH/bin).
	BinDir string
	// PathEnv is the current $PATH.
	PathEnv string
	// RCPath is the resolved shell config, "" for a shell haven does not know.
	RCPath string
	// RCHasLine is whether that file already contains the exact line.
	RCHasLine bool
}

// PlanHavenPath reduces the facts to the one thing to do about them.
func PlanHavenPath(f HavenPathFacts) HavenPathState {
	switch {
	case f.BinDir == "" || PathContains(f.PathEnv, f.BinDir):
		// No bin dir means no Go toolchain to have installed with, which the
		// prerequisite catalogue already reports. Nothing to say twice.
		return HavenPathReady
	case f.RCPath == "":
		return HavenPathManual
	case f.RCHasLine:
		return HavenPathPending
	default:
		return HavenPathOfferable
	}
}

// HavenPathRCBlock is what gets appended to the rc file: a blank line, a
// comment saying who wrote it and why, and the line itself. The comment is
// not decoration — this is someone else's shell config, and an unattributed
// line in it is the kind of thing people delete with no idea what breaks.
func HavenPathRCBlock(line string) string {
	return "\n# added by `haven install` (langwatch)\n" + line + "\n"
}
