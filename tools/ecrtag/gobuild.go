package ecrtag

import (
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
)

// goEnv changes what a Go build compiles without showing in `go list`.
var goEnv = regexp.MustCompile(`\b(GOFLAGS|GOEXPERIMENT)=`)

// goPlatformEnv picks the platform and cgo mode, which GoList fixes at
// linux/arm64 without cgo; goPlatform is what each may be set to.
var (
	goPlatformEnv = regexp.MustCompile(`\b(CGO_ENABLED|GOOS|GOARCH)=(\S*)`)
	goPlatform    = map[string][]string{
		"CGO_ENABLED": {"0"},
		"GOOS":        {"linux", "${TARGETOS}", "$TARGETOS"},
		"GOARCH":      {"arm64", "${TARGETARCH}", "$TARGETARCH"},
	}
)

// checkGoPlatform fails a platform or cgo setting other than the one go list
// reads with: a file only another platform, or cgo, compiles would not count.
func checkGoPlatform(text string) error {
	for _, m := range goPlatformEnv.FindAllStringSubmatch(text, -1) {
		if !slices.Contains(goPlatform[m[1]], strings.Trim(m[2], `"'`)) {
			return fmt.Errorf("%s=%s is not the linux/arm64, cgo-off build go list reads", m[1], m[2])
		}
	}

	return nil
}

// goBuildValueFlags take their value as the next word.
var goBuildValueFlags = []string{
	"-o", "-ldflags", "-gcflags", "-asmflags", "-mod", "-p", "-pkgdir",
	"-toolexec", "-buildmode", "-compiler", "-installsuffix",
}

// goBuildUnread change which files a build reads, which `go list` as run
// here would not see.
var goBuildUnread = []string{"-tags", "-C", "-overlay", "-modfile", "-pgo"}

// goToolOK are the go commands that read no source a build does not.
var goToolOK = []string{"build", "mod", "version", "env"}

// goBuilds is every `go build` in a RUN command, with the directory a `cd`
// before it moved to. A package that is not a relative path, or a `cd` that
// leaves the context, fails.
func goBuilds(cmd string) ([]goMain, error) {
	if goEnv.MatchString(cmd) {
		return nil, fmt.Errorf("RUN %s sets GOFLAGS or GOEXPERIMENT, which go list does not see", truncate(cmd))
	}
	if err := checkGoPlatform(cmd); err != nil {
		return nil, err
	}
	words := shellWords(cmd)
	scan := goScan{dir: "."}
	for i := 0; i < len(words); i++ {
		used, err := scan.step(words[i:])
		if err != nil {
			return nil, err
		}
		i += used
	}

	return scan.mains, nil
}

// goScan holds what goBuilds has read of a command: the directory its `cd`s
// moved to, and the go builds so far.
type goScan struct {
	dir   string
	mains []goMain
}

// step reads the word at the start of words, and returns how many words
// after it, it used.
func (g *goScan) step(words []string) (int, error) {
	if len(words) < 2 {
		return 0, nil
	}
	switch words[0] {
	case "cd":
		dir, err := cdDir(g.dir, words[1])
		g.dir = dir

		return 1, err
	case "go":
		built, used, err := goCommand(words[1:], g.dir)
		g.mains = append(g.mains, built...)

		return used, err
	}

	return 0, nil
}

// cdDir is the directory a `cd` moves to from dir. It fails on a directory
// that is not inside the context.
func cdDir(dir, next string) (string, error) {
	if path.IsAbs(next) || strings.Contains(next, "$") {
		return "", fmt.Errorf("cd %s before a go build is not a context directory", next)
	}

	return path.Join(dir, next), nil
}

// goCommand reads a go command, given its words after "go", run in dir. It
// returns the go builds it makes and how many words after "go" it used.
func goCommand(words []string, dir string) ([]goMain, int, error) {
	switch {
	case !slices.Contains(goToolOK, words[0]):
		return nil, 0, fmt.Errorf("go %s may read sources a go build does not, which the inputs reader cannot follow", words[0])
	case words[0] != "build":
		return nil, 0, nil
	}
	pkgs, end, err := goBuildPackages(words[1:])
	if err != nil {
		return nil, 0, err
	}
	mains := make([]goMain, 0, len(pkgs))
	for _, p := range pkgs {
		mains = append(mains, goMain{dir: dir, pkg: p})
	}

	return mains, 1 + end, nil
}

// goBuildPackages reads a go build's packages up to the end of its command.
func goBuildPackages(words []string) ([]string, int, error) {
	var pkgs []string
	i := 0
	for ; i < len(words) && !isCommandEnd(words[i]); i++ {
		pkg, skip, err := goBuildWord(words[i])
		if err != nil {
			return nil, 0, err
		}
		if pkg != "" {
			pkgs = append(pkgs, pkg)
		}
		i += skip
	}
	if len(pkgs) == 0 {
		pkgs = []string{"."}
	}

	return pkgs, i, nil
}

// isCommandEnd holds for a word that ends a shell command.
func isCommandEnd(w string) bool {
	return slices.Contains([]string{"&&", "||", ";", "|"}, w)
}

// goBuildWord reads one word of a go build: a package, or a flag. A flag
// that takes its value as the next word has skip 1.
func goBuildWord(w string) (pkg string, skip int, err error) {
	if !strings.HasPrefix(w, "-") {
		if w != "." && !strings.HasPrefix(w, "./") {
			return "", 0, fmt.Errorf("go build package %q is not a relative path", w)
		}

		return w, 0, nil
	}
	flag, _, _ := strings.Cut("-"+strings.TrimLeft(w, "-"), "=")
	if slices.Contains(goBuildUnread, flag) {
		return "", 0, fmt.Errorf("go build %s changes the files it reads, which go list as run here does not see", flag)
	}
	if slices.Contains(goBuildValueFlags, w) || slices.Contains(goBuildValueFlags, "-"+strings.TrimPrefix(w, "--")) {
		return "", 1, nil
	}

	return "", 0, nil
}
