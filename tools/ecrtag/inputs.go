package ecrtag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
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

// Hash is the image's inputs hash: the blob ids of its input files, its row
// of the build table (the image name, and what the workflow passes the build,
// such as the evaluator one Dockerfile builds every evaluator image for) and
// inputsVersion.
func (in Inputs) Hash(ctx context.Context, img ImageSpec) (string, error) {
	files, err := in.Files(ctx, img.Dockerfile)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	fmt.Fprintf(h, "%s\nrow %s\n", inputsVersion, img.Row)
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
	files := in.ignoreFiles(dockerfile)
	for _, s := range stages {
		matched, err := in.stageFiles(ctx, s)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", dockerfile, err)
		}
		for _, f := range matched {
			files[f] = true
		}
	}

	return sortedKeys(files), nil
}

// ignoreFiles is the Dockerfile and the .dockerignore files BuildKit reads
// for it, as a set.
func (in Inputs) ignoreFiles(dockerfile string) map[string]bool {
	files := map[string]bool{dockerfile: true}
	// BuildKit reads <Dockerfile>.dockerignore ahead of the root one.
	for _, ignore := range []string{".dockerignore", dockerfile + ".dockerignore"} {
		if _, ok := in.Tree[ignore]; ok {
			files[ignore] = true
		}
	}

	return files
}

// stageFiles is the files every source of the stage names.
func (in Inputs) stageFiles(ctx context.Context, s stage) ([]string, error) {
	deps, err := in.stageDeps(ctx, s)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, src := range s.sources {
		matched, err := in.expand(stageReads{stage: s, deps: deps}, src)
		if err != nil {
			return nil, err
		}
		out = append(out, matched...)
	}

	return out, nil
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
		// A list without the main's own package read the wrong tree (a
		// symlinked checkout, a WORKDIR the copies do not mirror); trusting it
		// would leave every Go source out.
		own := path.Join(m.dir, m.pkg) + "/"
		if !slices.ContainsFunc(files, func(f string) bool { return strings.HasPrefix(f, own) }) {
			return nil, fmt.Errorf("go list of %s in %s named no file of %s", m.pkg, m.dir, own)
		}
		for _, f := range files {
			deps[f] = true
		}
	}

	return deps, nil
}

// stageReads is a stage, and the files its Go builds read; deps is nil when
// the stage builds no Go and so reads every file it copies.
type stageReads struct {
	stage
	deps map[string]bool
}

// expand is the files one source names. With deps, a file of a Go module the
// source copies counts only when the build reads it, or is a go.mod, go.sum
// or profile. That holds only where the copy lands at the path the build
// reads it from, so a copy that does not mirror the context fails.
func (in Inputs) expand(r stageReads, src source) ([]string, error) {
	name := strings.TrimSuffix(strings.TrimPrefix(src.path, "./"), "/")
	var out []string
	for f := range in.Tree {
		root, ok := matchSource(name, f)
		if !ok {
			continue
		}
		filtered, err := in.filtered(r, src, root)
		if err != nil {
			return nil, err
		}
		if filtered && !r.deps[f] && !isModuleFile(f) {
			continue
		}
		out = append(out, f)
	}
	if len(out) == 0 && !in.anyMatch(name) {
		return nil, fmt.Errorf("COPY source %q names no file", name)
	}

	return out, nil
}

// filtered holds when the build reads only some files of the Go module the
// source copies at root. Only a file of such a module can be left unread.
func (in Inputs) filtered(r stageReads, src source, root string) (bool, error) {
	if r.deps == nil || !src.copied || !in.goModule(root) {
		return false, nil
	}

	return true, r.mirrors(src, root)
}

// mirrors holds when a Go module copied from root lands at <WORKDIR>/root,
// in the WORKDIR every go build of the stage runs in, as `go list` from the
// context root assumes.
func (s stage) mirrors(src source, root string) error {
	dest := src.dest
	if !path.IsAbs(dest) {
		dest = path.Join(src.workdir, dest)
	}
	if path.Clean(dest) != path.Join(src.workdir, root) {
		return fmt.Errorf("COPY %s %s copies Go module %s somewhere other than %s, which the inputs reader cannot follow", src.path, src.dest, root, path.Join(src.workdir, root))
	}
	for _, m := range s.mains {
		if m.workdir != src.workdir {
			return fmt.Errorf("go build %s runs in WORKDIR %s, not %s where Go module %s is copied", m.pkg, m.workdir, src.workdir, root)
		}
	}

	return nil
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

// isModuleFile is a file a Go build reads that `go list` does not name: a
// module's go.mod and go.sum, and a profile -pgo=auto reads (default.pgo).
func isModuleFile(f string) bool {
	base := path.Base(f)
	return base == "go.mod" || base == "go.sum" || strings.HasSuffix(base, ".pgo")
}

// matchSource reports whether a COPY source names the file, as the file
// itself, a directory holding it, or a glob matching either. root is the
// directory the source names ("" for a file or the whole context).
func matchSource(src, file string) (string, bool) {
	if src == "." || src == "" {
		return "", true
	}
	if strings.ContainsAny(src, "*?[") {
		return matchGlob(src, file)
	}

	return matchPath(src, file)
}

// matchPath matches a source without a glob: the file itself, or a directory
// holding it.
func matchPath(src, file string) (string, bool) {
	switch {
	case file == src:
		return "", true
	case strings.HasPrefix(file, src+"/"):
		return src, true
	}

	return "", false
}

// matchGlob matches whole path segments: the file, or a directory above it.
func matchGlob(src, file string) (string, bool) {
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
	sources []source
	mains   []goMain
}

// source is one context source: copied to dest under workdir, or bind-mounted.
type source struct {
	path, dest, workdir string
	copied              bool
}

type goMain struct{ dir, pkg, workdir string }

// goEnv changes what a Go build compiles without showing in `go list`.
var goEnv = regexp.MustCompile(`\b(GOFLAGS|GOEXPERIMENT)=`)

// escapeDirective changes the line continuation character, which
// logicalLines does not follow.
var escapeDirective = regexp.MustCompile(`(?mi)^#\s*escape\s*=`)

// parseDockerfile reads each stage's context sources: COPY and ADD without
// --from, and RUN bind mounts without from. A `go build` it cannot read
// fails, as does a heredoc or a variable in a source.
func parseDockerfile(text string) ([]stage, error) {
	if escapeDirective.MatchString(text) {
		return nil, errors.New("an escape directive is not read")
	}
	r := &dockerfileReader{workdir: "/"}
	for _, line := range logicalLines(text) {
		if err := r.read(line); err != nil {
			return nil, err
		}
	}

	return r.stages, nil
}

// dockerfileReader holds what parseDockerfile has read so far.
type dockerfileReader struct {
	stages  []stage
	workdir string
}

// current is the stage being read; instructions before any FROM go in one.
func (r *dockerfileReader) current() *stage {
	if len(r.stages) == 0 {
		r.stages = append(r.stages, stage{})
	}

	return &r.stages[len(r.stages)-1]
}

// read takes one instruction, one logical line.
func (r *dockerfileReader) read(line string) error {
	instruction := strings.Fields(line)[0]
	rest := strings.TrimSpace(strings.TrimPrefix(line, instruction))
	if strings.Contains(rest, "<<") {
		return fmt.Errorf("heredoc in %q is not read", truncate(line))
	}
	switch strings.ToUpper(instruction) {
	case "FROM":
		r.stages = append(r.stages, stage{})
		r.workdir = "/"
	case "WORKDIR":
		return r.setWorkdir(rest)
	case "ENV", "ARG":
		return checkGoEnv(instruction, rest)
	case "COPY", "ADD":
		return r.copy(rest)
	case "RUN":
		return r.run(rest)
	}

	return nil
}

// setWorkdir moves the WORKDIR, relative to the current one.
func (r *dockerfileReader) setWorkdir(rest string) error {
	if strings.Contains(rest, "$") {
		return fmt.Errorf("WORKDIR %s is not a path", rest)
	}
	r.workdir = path.Join(r.workdir, rest)
	if path.IsAbs(rest) {
		r.workdir = path.Clean(rest)
	}

	return nil
}

// checkGoEnv fails an ENV or ARG that changes a Go build without showing in
// go list.
func checkGoEnv(instruction, rest string) error {
	if goEnv.MatchString(rest) || strings.Contains(rest, "GOFLAGS") || strings.Contains(rest, "GOEXPERIMENT") {
		return fmt.Errorf("%s %s changes a Go build without showing in go list", instruction, truncate(rest))
	}

	return nil
}

// copy adds the context sources of a COPY or ADD to the current stage.
func (r *dockerfileReader) copy(rest string) error {
	paths, dest, err := copySources(rest)
	if err != nil {
		return err
	}
	for _, p := range paths {
		s := r.current()
		s.sources = append(s.sources, source{path: p, dest: dest, workdir: r.workdir, copied: true})
	}

	return nil
}

// run adds the bind mounts and the go builds of a RUN to the current stage.
func (r *dockerfileReader) run(rest string) error {
	s := r.current()
	mounts, body := runMounts(rest)
	for _, m := range mounts {
		s.sources = append(s.sources, source{path: m, workdir: r.workdir})
	}
	mains, err := goBuilds(body)
	if err != nil {
		return err
	}
	for i := range mains {
		mains[i].workdir = r.workdir
	}
	s.mains = append(s.mains, mains...)

	return nil
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

// copySources is a COPY or ADD's context sources, none with --from, and
// where they land.
func copySources(rest string) ([]string, string, error) {
	fields, fromStage, err := copyFlags(strings.Fields(rest))
	if err != nil || fromStage {
		return nil, "", err
	}
	args, err := copyArgs(fields, rest)
	if err != nil {
		return nil, "", err
	}
	if len(args) < 2 {
		return nil, "", fmt.Errorf("COPY %q names no source", truncate(rest))
	}
	sources := args[:len(args)-1]
	if err := checkCopySources(sources); err != nil {
		return nil, "", err
	}

	return sources, args[len(args)-1], nil
}

// copyFlags drops the flags in front of a COPY's arguments. fromStage holds
// for --from, whose sources are not the build context's.
func copyFlags(fields []string) (args []string, fromStage bool, err error) {
	for len(fields) > 0 && strings.HasPrefix(fields[0], "--") {
		if strings.HasPrefix(fields[0], "--from=") {
			return nil, true, nil
		}
		if strings.HasPrefix(fields[0], "--parents") {
			return nil, false, fmt.Errorf("COPY %s is not read", fields[0])
		}
		fields = fields[1:]
	}

	return fields, false, nil
}

// copyArgs is a COPY's sources and destination, in its JSON or shell form.
func copyArgs(fields []string, rest string) ([]string, error) {
	joined := strings.Join(fields, " ")
	if !strings.HasPrefix(joined, "[") {
		return fields, nil
	}
	var args []string
	if err := json.Unmarshal([]byte(joined), &args); err != nil {
		return nil, fmt.Errorf("read %q: %w", truncate(rest), err)
	}

	return args, nil
}

// checkCopySources fails a source that is not a path in the build context.
func checkCopySources(sources []string) error {
	for _, s := range sources {
		if strings.Contains(s, "$") || strings.Contains(s, "://") {
			return fmt.Errorf("COPY source %q is not a context path", s)
		}
	}

	return nil
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

// shellWords splits a command into words, honoring quotes. `&&`, `||`, `;`
// and `|` come out as words of their own.
func shellWords(cmd string) []string {
	var s shellScanner
	for i := 0; i < len(cmd); i++ {
		i = s.scan(cmd, i)
	}
	s.flush()

	return s.words
}

// shellScanner holds the words of a command split so far, and the word being
// read.
type shellScanner struct {
	words  []string
	word   strings.Builder
	inWord bool
}

// flush ends the word being read.
func (s *shellScanner) flush() {
	if s.inWord {
		s.words = append(s.words, s.word.String())
		s.word.Reset()
		s.inWord = false
	}
}

// operator ends the word being read and adds a shell operator as a word.
func (s *shellScanner) operator(op string) {
	s.flush()
	s.words = append(s.words, op)
}

// scan reads the character at i, and returns the index of the last character
// it used.
func (s *shellScanner) scan(cmd string, i int) int {
	c := cmd[i]
	switch {
	case c == '\'':
		return s.singleQuoted(cmd, i)
	case c == '"':
		return s.doubleQuoted(cmd, i)
	case c == ' ' || c == '\t':
		s.flush()
	case c == ';':
		s.operator(";")
	case (c == '&' || c == '|') && i+1 < len(cmd) && cmd[i+1] == c:
		s.operator(string([]byte{c, c}))

		return i + 1
	case c == '|':
		s.operator("|")
	default:
		s.word.WriteByte(c)
		s.inWord = true
	}

	return i
}

// singleQuoted reads the quote at i and the text after it, up to the closing
// quote, and returns the index of the closing quote.
func (s *shellScanner) singleQuoted(cmd string, i int) int {
	end := strings.IndexByte(cmd[i+1:], '\'')
	if end < 0 {
		end = len(cmd) - i - 1
	}
	s.word.WriteString(cmd[i+1 : i+1+end])
	s.inWord = true

	return i + end + 1
}

// doubleQuoted reads the quote at i and the text after it, up to the closing
// quote, where a backslash escapes the next character. It returns the index
// of the closing quote.
func (s *shellScanner) doubleQuoted(cmd string, i int) int {
	for i++; i < len(cmd) && cmd[i] != '"'; i++ {
		if cmd[i] == '\\' && i+1 < len(cmd) {
			i++
		}
		s.word.WriteByte(cmd[i])
	}
	s.inWord = true

	return i
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
