package ecrtag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// Hash is the image's inputs hash: the blob ids of its input files, its row
// of the build table (the image name, and what the workflow passes the build,
// such as the evaluator one Dockerfile builds every evaluator image for) and
// inputsVersion.
func (in Inputs) Hash(ctx context.Context, img ImageSpec) (string, error) {
	// go list reads for linux/arm64; another platform compiles other files.
	if img.Platform != "" && img.Platform != "linux/arm64" && !strings.HasPrefix(img.Platform, "linux/arm64/") {
		return "", fmt.Errorf("platform %s is not the linux/arm64 go list reads for", img.Platform)
	}
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
