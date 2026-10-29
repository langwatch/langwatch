package ecrtag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"slices"
	"strings"
)

// InputsKey is the label a build records its inputs hash under. The commit
// tag and RevisionKey stay the image's identity; this label only says whether
// a later commit would build the same image.
const InputsKey = "org.langwatch.inputs"

// inputsVersion is part of every hash. Bump it to rebuild every image once,
// for a build change the inputs cannot see (a build argument, a platform).
const inputsVersion = "langwatch-image-inputs/1"

// Tree is a commit's files, each path to its git blob id.
type Tree map[string]string

// GoDeps lists the repository files a `go build` of pkg, run in the
// repository directory dir, compiles or embeds.
type GoDeps func(ctx context.Context, dir, pkg string) ([]string, error)

// Inputs reads what an image is built from: every file its Dockerfile copies
// or bind-mounts from the build context, read from the Dockerfile itself. A
// stage that runs `go build` reads, from a Go module it copies, only the files
// of the packages that build compiles and the modules' go.mod and go.sum, so
// a change to a package the binary does not import builds nothing.
type Inputs struct {
	Tree Tree
	// Read returns a file's content at the commit Tree lists.
	Read   func(path string) (string, error)
	GoDeps GoDeps
}

// Hash is the image's inputs hash: the blob ids of its input files, the image
// name (one Dockerfile builds every evaluator image) and inputsVersion.
func (in Inputs) Hash(ctx context.Context, image, dockerfile string) (string, error) {
	files, err := in.Files(ctx, dockerfile)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	fmt.Fprintf(h, "%s\nimage %s\n", inputsVersion, image)
	for _, f := range files {
		fmt.Fprintf(h, "%s %s\n", in.Tree[f], f)
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

// Files is every input file of the Dockerfile, sorted. It fails rather than
// guess: an instruction it cannot read, or a source that names no file.
func (in Inputs) Files(ctx context.Context, dockerfile string) ([]string, error) {
	text, err := in.Read(dockerfile)
	if err != nil {
		return nil, err
	}
	stages, err := parseDockerfile(text)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", dockerfile, err)
	}
	files := map[string]bool{dockerfile: true}
	if _, ok := in.Tree[".dockerignore"]; ok {
		files[".dockerignore"] = true
	}
	for _, s := range stages {
		deps, err := in.stageDeps(ctx, s)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", dockerfile, err)
		}
		for _, src := range s.sources {
			matched, err := in.expand(src, deps)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", dockerfile, err)
			}
			for _, f := range matched {
				files[f] = true
			}
		}
	}

	return sortedKeys(files), nil
}

// stageDeps is the set of files the stage's Go builds read, or nil when the
// stage builds no Go and so reads every file it copies.
func (in Inputs) stageDeps(ctx context.Context, s stage) (map[string]bool, error) {
	if len(s.mains) == 0 {
		return nil, nil
	}
	deps := map[string]bool{}
	for _, m := range s.mains {
		files, err := in.GoDeps(ctx, m.dir, m.pkg)
		if err != nil {
			return nil, fmt.Errorf("list the packages of go build %s in %s: %w", m.pkg, m.dir, err)
		}
		for _, f := range files {
			deps[f] = true
		}
	}

	return deps, nil
}

// expand is the files one source names. With deps, a file of a copied Go
// module counts only when the build reads it, or is a go.mod or go.sum.
func (in Inputs) expand(src string, deps map[string]bool) ([]string, error) {
	src = strings.TrimSuffix(strings.TrimPrefix(src, "./"), "/")
	var out []string
	for f := range in.Tree {
		root, ok := matchSource(src, f)
		if !ok {
			continue
		}
		if deps != nil && in.goModule(root) && !deps[f] && !isModuleFile(f) {
			continue
		}
		out = append(out, f)
	}
	if len(out) == 0 && !in.anyMatch(src) {
		return nil, fmt.Errorf("COPY source %q names no file", src)
	}

	return out, nil
}

// anyMatch: a Go module whose every file was left out still names files.
func (in Inputs) anyMatch(src string) bool {
	for f := range in.Tree {
		if _, ok := matchSource(src, f); ok {
			return true
		}
	}

	return false
}

// goModule holds when dir is the root of a Go module.
func (in Inputs) goModule(dir string) bool {
	_, ok := in.Tree[path.Join(dir, "go.mod")]
	return ok && dir != ""
}

func isModuleFile(f string) bool {
	base := path.Base(f)
	return base == "go.mod" || base == "go.sum"
}

// matchSource reports whether a COPY source names the file, as the file
// itself, a directory holding it, or a glob matching either. root is the
// directory the source names ("" for a file or the whole context).
func matchSource(src, file string) (string, bool) {
	if src == "." || src == "" {
		return "", true
	}
	if !strings.ContainsAny(src, "*?[") {
		switch {
		case file == src:
			return "", true
		case strings.HasPrefix(file, src+"/"):
			return src, true
		}

		return "", false
	}
	// A glob matches whole path segments: the file, or a directory above it.
	segments := strings.Split(file, "/")
	for i := len(segments); i > 0; i-- {
		prefix := strings.Join(segments[:i], "/")
		if ok, _ := path.Match(src, prefix); ok {
			if i == len(segments) {
				return "", true
			}

			return prefix, true
		}
	}

	return "", false
}

// stage is one FROM of a Dockerfile: what it reads from the build context,
// and the Go packages it builds.
type stage struct {
	sources []string
	mains   []goMain
}

type goMain struct{ dir, pkg string }

// parseDockerfile reads each stage's context sources: COPY and ADD without
// --from, and RUN bind mounts without from. A `go build` it cannot read
// fails, as does a heredoc or a variable in a source.
func parseDockerfile(text string) ([]stage, error) {
	var stages []stage
	cur := func() *stage {
		if len(stages) == 0 {
			stages = append(stages, stage{})
		}
		return &stages[len(stages)-1]
	}
	for _, line := range logicalLines(text) {
		instruction, rest, _ := strings.Cut(line, " ")
		rest = strings.TrimSpace(rest)
		if strings.Contains(rest, "<<") {
			return nil, fmt.Errorf("heredoc in %q is not read", truncate(line))
		}
		switch strings.ToUpper(instruction) {
		case "FROM":
			stages = append(stages, stage{})
		case "COPY", "ADD":
			sources, err := copySources(rest)
			if err != nil {
				return nil, err
			}
			cur().sources = append(cur().sources, sources...)
		case "RUN":
			s := cur()
			mounts, body := runMounts(rest)
			s.sources = append(s.sources, mounts...)
			mains, err := goBuilds(body)
			if err != nil {
				return nil, err
			}
			s.mains = append(s.mains, mains...)
		}
	}

	return stages, nil
}

// logicalLines joins continued lines and drops comments.
func logicalLines(text string) []string {
	var out []string
	var b strings.Builder
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "#") || (line == "" && b.Len() > 0) {
			continue
		}
		if cont, ok := strings.CutSuffix(line, "\\"); ok {
			b.WriteString(cont)
			b.WriteString(" ")
			continue
		}
		b.WriteString(line)
		if s := strings.TrimSpace(b.String()); s != "" {
			out = append(out, s)
		}
		b.Reset()
	}

	return out
}

// copySources is a COPY or ADD's context sources: none with --from.
func copySources(rest string) ([]string, error) {
	var args []string
	fields := strings.Fields(rest)
	for len(fields) > 0 && strings.HasPrefix(fields[0], "--") {
		if strings.HasPrefix(fields[0], "--from=") {
			return nil, nil
		}
		fields = fields[1:]
	}
	joined := strings.Join(fields, " ")
	if strings.HasPrefix(joined, "[") {
		if err := json.Unmarshal([]byte(joined), &args); err != nil {
			return nil, fmt.Errorf("read %q: %w", truncate(rest), err)
		}
	} else {
		args = fields
	}
	if len(args) < 2 {
		return nil, fmt.Errorf("COPY %q names no source", truncate(rest))
	}
	sources := args[:len(args)-1]
	for _, s := range sources {
		if strings.Contains(s, "$") || strings.Contains(s, "://") {
			return nil, fmt.Errorf("COPY source %q is not a context path", s)
		}
	}

	return sources, nil
}

// runMounts is a RUN's bind-mounted context sources, and its command.
func runMounts(rest string) ([]string, string) {
	var sources []string
	fields := strings.Fields(rest)
	for len(fields) > 0 && strings.HasPrefix(fields[0], "--") {
		if opts, ok := strings.CutPrefix(fields[0], "--mount="); ok {
			if source, ok := bindSource(opts); ok {
				sources = append(sources, source)
			}
		}
		fields = fields[1:]
	}

	return sources, strings.Join(fields, " ")
}

// bindSource is a bind mount's context source; "." when it names none.
func bindSource(opts string) (string, bool) {
	kind, source := "bind", "."
	for _, opt := range strings.Split(opts, ",") {
		key, value, _ := strings.Cut(opt, "=")
		switch key {
		case "type":
			kind = value
		case "from":
			return "", false
		case "source", "src":
			source = value
		}
	}

	return source, kind == "bind"
}

// goBuildValueFlags take their value as the next word.
var goBuildValueFlags = []string{
	"-o", "-ldflags", "-gcflags", "-asmflags", "-tags", "-mod", "-modfile", "-p", "-pkgdir",
	"-toolexec", "-overlay", "-pgo", "-buildmode", "-compiler", "-installsuffix", "-C",
}

// goBuilds is every `go build` in a RUN command, with the directory a `cd`
// before it moved to. A package that is not a relative path, or a `cd` that
// leaves the context, fails.
func goBuilds(cmd string) ([]goMain, error) {
	words := shellWords(cmd)
	var mains []goMain
	dir := "."
	for i := 0; i < len(words); i++ {
		switch {
		case words[i] == "cd" && i+1 < len(words):
			next := words[i+1]
			if path.IsAbs(next) || strings.Contains(next, "$") {
				return nil, fmt.Errorf("cd %s before a go build is not a context directory", next)
			}
			dir = path.Join(dir, next)
			i++
		case words[i] == "go" && i+1 < len(words) && words[i+1] == "build":
			pkgs, end, err := goBuildPackages(words[i+2:])
			if err != nil {
				return nil, err
			}
			for _, p := range pkgs {
				mains = append(mains, goMain{dir: dir, pkg: p})
			}
			i += 1 + end
		}
	}

	return mains, nil
}

// goBuildPackages reads a go build's packages up to the end of its command.
func goBuildPackages(words []string) ([]string, int, error) {
	var pkgs []string
	i := 0
	for ; i < len(words); i++ {
		w := words[i]
		if slices.Contains([]string{"&&", "||", ";", "|"}, w) {
			break
		}
		if strings.HasPrefix(w, "-") {
			if slices.Contains(goBuildValueFlags, w) || slices.Contains(goBuildValueFlags, "-"+strings.TrimPrefix(w, "--")) {
				i++
			}
			continue
		}
		if w != "." && !strings.HasPrefix(w, "./") {
			return nil, 0, fmt.Errorf("go build package %q is not a relative path", w)
		}
		pkgs = append(pkgs, w)
	}
	if len(pkgs) == 0 {
		pkgs = []string{"."}
	}

	return pkgs, i, nil
}

// shellWords splits a command into words, honouring quotes. `&&`, `||`, `;`
// and `|` come out as words of their own.
func shellWords(cmd string) []string {
	var words []string
	var b strings.Builder
	inWord := false
	flush := func() {
		if inWord {
			words = append(words, b.String())
			b.Reset()
			inWord = false
		}
	}
	for i := 0; i < len(cmd); i++ {
		c := cmd[i]
		switch {
		case c == '\'':
			end := strings.IndexByte(cmd[i+1:], '\'')
			if end < 0 {
				end = len(cmd) - i - 1
			}
			b.WriteString(cmd[i+1 : i+1+end])
			i += end + 1
			inWord = true
		case c == '"':
			i++
			for ; i < len(cmd) && cmd[i] != '"'; i++ {
				if cmd[i] == '\\' && i+1 < len(cmd) {
					i++
				}
				b.WriteByte(cmd[i])
			}
			inWord = true
		case c == ' ' || c == '\t':
			flush()
		case c == ';':
			flush()
			words = append(words, ";")
		case (c == '&' || c == '|') && i+1 < len(cmd) && cmd[i+1] == c:
			flush()
			words = append(words, string([]byte{c, c}))
			i++
		case c == '|':
			flush()
			words = append(words, "|")
		default:
			b.WriteByte(c)
			inWord = true
		}
	}
	flush()

	return words
}

func truncate(s string) string {
	if len(s) > 80 {
		return s[:80] + "…"
	}
	return s
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)

	return out
}
