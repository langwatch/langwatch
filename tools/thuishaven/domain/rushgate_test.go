package domain

import (
	"errors"
	"io/fs"
	"testing"
)

// @scenario "A rush preload that gates nothing leaves the run to haven's slot"
func TestUnderRushGate(t *testing.T) {
	const preload = "--require /home/x/.config/rush/gate/node/preload.cjs"
	const namesPath = "/home/x/.config/rush/gate/node/names"
	oxlint := []string{"/usr/bin/node", "/repo/node_modules/.pnpm/oxlint@1.85.0/node_modules/oxlint/bin/oxlint", "--quiet", "a.ts"}
	cases := []struct {
		name  string
		env   map[string]string
		names string // contents of the preload's names file; empty means no file
		argv  []string
		want  bool
	}{
		{"no rush", map[string]string{"NODE_OPTIONS": "--max-old-space-size=4096"}, "", oxlint, false},
		{"gate held", map[string]string{RushGateHeldEnv: "1"}, "", oxlint, true},
		{"preload naming the program", map[string]string{"NODE_OPTIONS": preload}, "/usr/bin/rush\noxlint\n", oxlint, true},
		{"preload naming the package", map[string]string{"NODE_OPTIONS": preload}, "/usr/bin/rush\nvitest\n", []string{"/usr/bin/node", "/repo/node_modules/vitest/vitest.mjs", "run"}, true},
		{"preload with no names file", map[string]string{"NODE_OPTIONS": preload}, "", oxlint, false},
		{"preload naming other programs", map[string]string{"NODE_OPTIONS": preload}, "/usr/bin/rush\ntsc\n", oxlint, false},
		{"preload lets a watch run through", map[string]string{"NODE_OPTIONS": preload}, "/usr/bin/rush\noxlint\n", append(oxlint, "--watch"), false},
		{"a shell under a preload with names", map[string]string{"NODE_OPTIONS": preload}, "/usr/bin/rush\noxlint\n", nil, true},
		{"a shell under a preload with none", map[string]string{"NODE_OPTIONS": preload}, "", nil, false},
		{"handed to rush once already", map[string]string{"NODE_OPTIONS": preload, RushPassedEnv: "1"}, "/usr/bin/rush\noxlint\n", oxlint, false},
	}
	for _, c := range cases {
		readFile := func(path string) ([]byte, error) {
			if path != namesPath || c.names == "" {
				return nil, fs.ErrNotExist
			}
			return []byte(c.names), nil
		}
		if got := UnderRushGate(func(k string) string { return c.env[k] }, readFile, c.argv); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
	onlyPreload := func(k string) string {
		if k == "NODE_OPTIONS" {
			return preload
		}
		return ""
	}
	if UnderRushGate(onlyPreload, func(string) ([]byte, error) { return nil, errors.New("unreadable") }, oxlint) {
		t.Error("an unreadable names file must gate nothing")
	}
}
