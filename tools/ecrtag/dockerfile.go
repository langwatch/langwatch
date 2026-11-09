package ecrtag

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// stage is one FROM of a Dockerfile: what it reads from the build context,
// and the Go packages it builds.
type stage struct {
	sources []source
	mains   []goMain
	// name is the stage's FROM ... AS alias, and inherits every stage or
	// image it builds on: its FROM, COPY --from and RUN --mount from.
	name     string
	inherits []string
}

// source is one context source: copied to dest under workdir, or bind-mounted.
type source struct {
	path, dest, workdir string
	copied              bool
}

type goMain struct{ dir, pkg, workdir string }

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
	if err := checkInherited(r.stages); err != nil {
		return nil, err
	}

	return r.stages, nil
}

// checkInherited fails a stage that runs go build on top of an earlier stage
// that read the build context: the files its build reads were counted, if at
// all, for that stage's builds, not this one's.
func checkInherited(stages []stage) error {
	for i := range stages {
		if len(stages[i].mains) == 0 {
			continue
		}
		for j := range stages[:i] {
			if readsContext(stages[j]) && inheritsFrom(stages[i], stages[j], j) {
				return fmt.Errorf("go build %s runs on stage %s, which read the build context; the inputs reader cannot follow it", stages[i].mains[0].pkg, stageName(stages[j], j))
			}
		}
	}

	return nil
}

func readsContext(s stage) bool { return len(s.sources) > 0 || len(s.mains) > 0 }

// inheritsFrom holds when s builds on the earlier stage, by alias or index.
func inheritsFrom(s, earlier stage, index int) bool {
	return slices.ContainsFunc(s.inherits, func(n string) bool {
		return n == strconv.Itoa(index) || (earlier.name != "" && strings.EqualFold(n, earlier.name))
	})
}

func stageName(s stage, index int) string {
	if s.name != "" {
		return s.name
	}

	return strconv.Itoa(index)
}

// fromStage is the stage a FROM starts: the image or stage it builds on, and
// its AS alias.
func fromStage(rest string) stage {
	var words []string
	for _, w := range strings.Fields(rest) {
		if !strings.HasPrefix(w, "--") {
			words = append(words, w)
		}
	}
	s := stage{}
	if len(words) > 0 {
		s.inherits = []string{words[0]}
	}
	if len(words) == 3 && strings.EqualFold(words[1], "AS") {
		s.name = words[2]
	}

	return s
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
		r.stages = append(r.stages, fromStage(rest))
		r.workdir = "/"
	case "WORKDIR":
		return r.setWorkdir(rest)
	case "ENV", "ARG":
		if err := checkGoPlatform(rest); err != nil {
			return err
		}
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
	paths, dest, from, err := copySources(rest)
	if err != nil {
		return err
	}
	s := r.current()
	if from != "" {
		s.inherits = append(s.inherits, from)
	}
	for _, p := range paths {
		s.sources = append(s.sources, source{path: p, dest: dest, workdir: r.workdir, copied: true})
	}

	return nil
}

// run adds the bind mounts and the go builds of a RUN to the current stage.
func (r *dockerfileReader) run(rest string) error {
	s := r.current()
	mounts, froms, body := runMounts(rest)
	for _, m := range mounts {
		s.sources = append(s.sources, source{path: m, workdir: r.workdir})
	}
	s.inherits = append(s.inherits, froms...)
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

// copySources is a COPY or ADD's context sources and where they land, or,
// with --from, the stage or image it copies from instead.
func copySources(rest string) (sources []string, dest, from string, err error) {
	fields, from, err := copyFlags(strings.Fields(rest))
	if err != nil || from != "" {
		return nil, "", from, err
	}
	args, err := copyArgs(fields, rest)
	if err != nil {
		return nil, "", "", err
	}
	if len(args) < 2 {
		return nil, "", "", fmt.Errorf("COPY %q names no source", truncate(rest))
	}
	sources = args[:len(args)-1]
	if err := checkCopySources(sources); err != nil {
		return nil, "", "", err
	}

	return sources, args[len(args)-1], "", nil
}

// copyFlags drops the flags in front of a COPY's arguments. from is --from's
// stage or image, whose files are not the build context's.
func copyFlags(fields []string) (args []string, from string, err error) {
	for len(fields) > 0 && strings.HasPrefix(fields[0], "--") {
		if name, ok := strings.CutPrefix(fields[0], "--from="); ok {
			return nil, name, nil
		}
		if strings.HasPrefix(fields[0], "--parents") {
			return nil, "", fmt.Errorf("COPY %s is not read", fields[0])
		}
		fields = fields[1:]
	}

	return fields, "", nil
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

// runMounts is a RUN's bind-mounted context sources, the stages or images
// its mounts read from instead, and its command.
func runMounts(rest string) (sources, froms []string, cmd string) {
	fields := strings.Fields(rest)
	for len(fields) > 0 && strings.HasPrefix(fields[0], "--") {
		if opts, ok := strings.CutPrefix(fields[0], "--mount="); ok {
			m := readMount(opts)
			switch {
			case m.from != "":
				froms = append(froms, m.from)
			case m.kind == "bind":
				sources = append(sources, m.source)
			}
		}
		fields = fields[1:]
	}

	return sources, froms, strings.Join(fields, " ")
}

// mount is one RUN --mount; a bind mount's source is "." when it names none.
type mount struct{ kind, source, from string }

func readMount(opts string) mount {
	m := mount{kind: "bind", source: "."}
	for _, opt := range strings.Split(opts, ",") {
		key, value, _ := strings.Cut(opt, "=")
		switch key {
		case "type":
			m.kind = value
		case "from":
			m.from = value
		case "source", "src":
			m.source = value
		}
	}

	return m
}
