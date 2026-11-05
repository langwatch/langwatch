package migrationorder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os/exec"
	"path"
	"regexp"
	"slices"
	"strings"
)

// ReleasesDirectory holds one manifest per release, <version>.json, written by
// the stamp step in the release PR (plan 5.3, D9).
const ReleasesDirectory = "packages/upgrade/releases"

// StepRoots are where modules declare their code steps (.withMigrations).
var StepRoots = []string{"modules", "enterprise/modules"}

// manifest is the part of a release manifest this check reads.
type manifest struct {
	Release string `json:"release"`
	Steps   []struct {
		ID string `json:"id"`
	} `json:"steps"`
}

// ReleasedStep is a code step a release manifest names, with its declaration
// on the base branch and on the branch head.
type ReleasedStep struct {
	ID      string
	Release string
	// Path is repository-relative, on the base branch.
	Path string
	// Base is the declaration on the base branch: the defineMigrationStep call
	// holding the id, or the whole file when no such call encloses it.
	Base string
	// Head is the same declaration on the branch head, at HeadPath; empty
	// when the branch no longer declares the id anywhere.
	Head     string
	HeadPath string
	// wholeFile marks a Base that is the whole file, not a call.
	wholeFile bool
}

// StepInput is what the step check reads: the released code steps.
type StepInput struct {
	BaseRef  string
	Released []ReleasedStep
}

// CheckSteps reports every released code step whose declaration the branch
// changed or removed. A step a release shipped has run on real installs, so
// its declaration is frozen (rethink 6.5 point 2); the rest of its file may
// change, and a changed step is a new step with a new id.
func CheckSteps(in StepInput) []Finding {
	var findings []Finding
	for _, step := range in.Released {
		restore := fmt.Sprintf("restore the defineMigrationStep block declaring %s as `git show %s:%s` has it, and declare the change as a new step with a new id",
			step.ID, in.BaseRef, shellArg(step.Path))
		switch {
		case step.Head == "":
			findings = append(findings, Finding{
				Set:     "Code steps",
				Entry:   step.Path,
				Problem: fmt.Sprintf("released step %s was removed: release %s shipped it, and a released step cannot change", step.ID, step.Release),
				Fix:     restore,
			})
		case normalise(step.Head) != normalise(step.Base):
			findings = append(findings, Finding{
				Set:   "Code steps",
				Entry: step.HeadPath,
				Problem: fmt.Sprintf("declares %s, which release %s shipped, and a released step cannot change: declare a new step instead",
					step.ID, step.Release),
				Fix: restore,
			})
		}
	}
	slices.SortFunc(findings, func(a, b Finding) int { return strings.Compare(a.Entry+a.Problem, b.Entry+b.Problem) })
	return slices.Compact(findings)
}

// normalise collapses whitespace, so reformatting a declaration is no change.
func normalise(block string) string {
	return strings.Join(strings.Fields(block), " ")
}

// isCodeStep reports whether a manifest step id names a module's code step
// rather than a Prisma folder or a goose version (plan 5.3 step id grammar).
func isCodeStep(id string) bool {
	owner, name, ok := strings.Cut(id, ":")
	return ok && name != "" && owner != "prisma" && owner != "clickhouse"
}

// Steps reads the released code steps from the manifests on baseRef and on
// every release line, finds the base branch declaration of each by its quoted
// id, and the same declaration on HEAD: at the same path first, else anywhere.
func (r Repo) Steps(ctx context.Context, baseRef string, releasedRefs ...string) (StepInput, error) {
	in := StepInput{BaseRef: baseRef}
	releaseOf := map[string]string{}
	for _, ref := range slices.Concat([]string{baseRef}, releasedRefs) {
		if err := r.readManifests(ctx, ref, releaseOf); err != nil {
			return StepInput{}, err
		}
	}
	if len(releaseOf) == 0 {
		return in, nil
	}
	ids := slices.Sorted(maps.Keys(releaseOf))
	declared, err := r.declaringFiles(ctx, baseRef, ids)
	if err != nil {
		return StepInput{}, err
	}
	reader := fileReader{repo: r, ctx: ctx, cache: map[string]string{}}
	var headDeclared []declaration
	headSearched := false
	for _, id := range ids {
		bases, err := reader.baseDeclarations(baseRef, id, declared)
		if err != nil {
			return StepInput{}, err
		}
		for _, step := range bases {
			step.Release = releaseOf[id]
			head, err := reader.read("HEAD", step.Path)
			if err != nil {
				return StepInput{}, err
			}
			step.HeadPath, step.Head = step.Path, blockAt(head, id, step.wholeFile)
			if step.Head == "" {
				if !headSearched {
					if headDeclared, err = r.declaringFiles(ctx, "HEAD", ids); err != nil {
						return StepInput{}, err
					}
					headSearched = true
				}
				if step.HeadPath, step.Head, err = reader.findBlock("HEAD", id, headDeclared); err != nil {
					return StepInput{}, err
				}
			}
			in.Released = append(in.Released, step)
		}
	}
	return in, nil
}

// baseDeclarations returns the base branch files declaring id in a
// defineMigrationStep call; when none does, every file naming it, whole.
func (reader *fileReader) baseDeclarations(ref, id string, declared []declaration) ([]ReleasedStep, error) {
	var steps, wholeFiles []ReleasedStep
	for _, d := range declared {
		if d.id != id {
			continue
		}
		content, err := reader.read(ref, d.path)
		if err != nil {
			return nil, err
		}
		wholeFiles = append(wholeFiles, ReleasedStep{ID: id, Path: d.path, Base: content, wholeFile: true})
		if block := stepBlock(content, id); block != "" {
			steps = append(steps, ReleasedStep{ID: id, Path: d.path, Base: block})
		}
	}
	if len(steps) == 0 {
		return wholeFiles, nil
	}
	return steps, nil
}

// findBlock returns the first file on ref, by path, that declares id in a
// defineMigrationStep call, and that call.
func (reader *fileReader) findBlock(ref, id string, declared []declaration) (string, string, error) {
	for _, d := range declared {
		if d.id != id {
			continue
		}
		content, err := reader.read(ref, d.path)
		if err != nil {
			return "", "", err
		}
		if block := stepBlock(content, id); block != "" {
			return d.path, block, nil
		}
	}
	return "", "", nil
}

// blockAt returns id's defineMigrationStep call in content, or the whole
// content when the base declaration was the whole file.
func blockAt(content, id string, wholeFile bool) string {
	if wholeFile && content != "" {
		return content
	}
	return stepBlock(content, id)
}

// fileReader reads files at a ref once each. A file the ref's tree does not
// list reads empty; any other git failure is an error, never a missing file.
type fileReader struct {
	repo  Repo
	ctx   context.Context
	cache map[string]string
}

func (reader *fileReader) read(ref, file string) (string, error) {
	key := ref + ":" + file
	if cached, ok := reader.cache[key]; ok {
		return cached, nil
	}
	listed, err := reader.repo.git(reader.ctx, "ls-tree", "--name-only", "--full-name", ref, "--", file)
	if err != nil {
		return "", err
	}
	content := ""
	if slices.Contains(lines(listed), file) {
		if content, err = reader.repo.git(reader.ctx, "show", key); err != nil {
			return "", err
		}
	}
	reader.cache[key] = content
	return content, nil
}

// idProperty matches the id property of a step declaration, any quote style.
func idProperty(id string) *regexp.Regexp {
	quoted := regexp.QuoteMeta(id)
	return regexp.MustCompile(`\bid\s*:\s*(?:"` + quoted + `"|'` + quoted + `'|` + "`" + quoted + "`" + `)`)
}

const stepCall = "defineMigrationStep("

// stepBlock returns the defineMigrationStep(...) call whose id property is
// id, found by balanced brackets from the call start; empty when none is.
func stepBlock(content, id string) string {
	for _, loc := range idProperty(id).FindAllStringIndex(content, -1) {
		for start := strings.LastIndex(content[:loc[0]], stepCall); start >= 0; start = strings.LastIndex(content[:start], stepCall) {
			if end := closingParen(content, start+len(stepCall)-1); end > loc[1] {
				return content[start : end+1]
			}
		}
	}
	return ""
}

// closingParen returns the index of the bracket closing the one at open,
// skipping string literals and comments; -1 when it never closes.
func closingParen(content string, open int) int {
	depth := 0
	for i := open; i < len(content); i++ {
		switch c := content[i]; c {
		case '(', '{', '[':
			depth++
		case ')', '}', ']':
			depth--
			if depth == 0 {
				return i
			}
		case '"', '\'', '`':
			i = skipString(content, i, c)
		case '/':
			i = skipComment(content, i)
		}
	}
	return -1
}

func skipString(content string, start int, quote byte) int {
	for i := start + 1; i < len(content); i++ {
		switch content[i] {
		case '\\':
			i++
		case quote:
			return i
		}
	}
	return len(content)
}

func skipComment(content string, start int) int {
	rest := content[start:]
	switch {
	case strings.HasPrefix(rest, "//"):
		if end := strings.IndexByte(rest, '\n'); end >= 0 {
			return start + end
		}
		return len(content)
	case strings.HasPrefix(rest, "/*"):
		if end := strings.Index(rest[2:], "*/"); end >= 0 {
			return start + 2 + end + 1
		}
		return len(content)
	}
	return start
}

// readManifests adds every code step id the manifests on ref name, keeping
// the first manifest (base branch first, then in file order) that names each.
func (r Repo) readManifests(ctx context.Context, ref string, releaseOf map[string]string) error {
	files, err := r.entriesAt(ctx, ref, ReleasesDirectory)
	if err != nil {
		return err
	}
	for _, file := range files {
		if path.Ext(file) != ".json" {
			continue
		}
		m, err := r.readManifest(ctx, ref, file)
		if err != nil {
			return err
		}
		addCodeSteps(m, releaseOf)
	}
	return nil
}

func addCodeSteps(m manifest, releaseOf map[string]string) {
	for _, step := range m.Steps {
		if _, known := releaseOf[step.ID]; isCodeStep(step.ID) && !known {
			releaseOf[step.ID] = m.Release
		}
	}
}

func (r Repo) readManifest(ctx context.Context, ref, file string) (manifest, error) {
	content, err := r.git(ctx, "show", ref+":"+ReleasesDirectory+"/"+file)
	if err != nil {
		return manifest{}, err
	}
	var m manifest
	if err := json.Unmarshal([]byte(content), &m); err != nil {
		return manifest{}, fmt.Errorf("release manifest %s:%s/%s is not valid JSON: %w", ref, ReleasesDirectory, file, err)
	}
	return m, nil
}

// declaration is one file declaring one step id.
type declaration struct {
	id   string
	path string
}

// declaringFiles finds the non-test files under StepRoots on ref that hold a
// step id as a quoted literal, the form defineMigrationStep({ id }) takes.
func (r Repo) declaringFiles(ctx context.Context, ref string, ids []string) ([]declaration, error) {
	args := []string{"grep", "-o", "-F", "--full-name"}
	for _, id := range ids {
		for _, quote := range []string{`"`, `'`, "`"} {
			args = append(args, "-e", quote+id+quote)
		}
	}
	args = append(args, ref, "--")
	args = append(args, StepRoots...)
	out, err := r.git(ctx, args...)
	var exit *exec.ExitError
	if err != nil && (!errors.As(err, &exit) || exit.ExitCode() != 1) {
		return nil, err
	}
	var found []declaration
	for _, line := range lines(out) {
		if d, ok := parseDeclaration(ref, line); ok {
			found = append(found, d)
		}
	}
	slices.SortFunc(found, func(a, b declaration) int { return strings.Compare(a.path+a.id, b.path+b.id) })
	return slices.Compact(found), nil
}

// parseDeclaration reads one `git grep -o` line, <ref>:<path>:<quoted id>,
// skipping test files, which may name a step without declaring it.
func parseDeclaration(ref, line string) (declaration, bool) {
	rest, ok := strings.CutPrefix(line, ref+":")
	if !ok {
		return declaration{}, false
	}
	file, match, ok := strings.Cut(rest, ":")
	if !ok || strings.Contains(file, "/__tests__/") || strings.Contains(file, ".test.") {
		return declaration{}, false
	}
	return declaration{id: strings.Trim(match, "\"'`"), path: file}, true
}
