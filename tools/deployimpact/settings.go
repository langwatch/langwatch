package deployimpact

import (
	"regexp"
	"strings"
)

// setting is what a tree knows about one environment variable it reads.
type setting struct {
	Required bool
	Paths    []string
}

var (
	// tsRead is a config leaf, `c.env("NAME", schema)` (packages/config).
	tsRead = regexp.MustCompile(`\bc\.env\(\s*"([A-Z][A-Z0-9_]*)"`)
	// goTag is a Go config field's struct tag: `env:"NAME,opts" validate:"..."`.
	goTag      = regexp.MustCompile("`[^`]*\\benv:\"([A-Z][A-Z0-9_]*)([^\"]*)\"[^`]*`")
	constDef   = regexp.MustCompile(`(?m)^(?:export\s+)?const\s+(\w+)\s*=`)
	identifier = regexp.MustCompile(`\b[A-Za-z_]\w*\b`)
	// lenient is a schema an unset variable still parses against.
	lenient = regexp.MustCompile(`(?i)optional|default|nullish|\.catch\(`)
)

// envSchemas holds the shared schemas a config leaf names instead of spelling out.
const envSchemas = "packages/config/src/env-schemas.ts"

// readings is every environment variable a tree's code reads, by name.
type readings map[string]setting

func (r readings) add(name, path string, required bool) {
	entry := r[name]
	entry.Required = entry.Required || required
	entry.Paths = append(entry.Paths, path)
	r[name] = entry
}

// settings reads every environment variable the tree's code reads, by name.
func settings(tree Tree) (readings, error) {
	found := readings{}
	if err := tsSettings(tree, found); err != nil {
		return nil, err
	}
	return found, goSettings(tree, found)
}

func tsSettings(tree Tree, found readings) error {
	shared, err := tree.Read(envSchemas)
	if err != nil {
		return err
	}
	files, err := tree.Grep(`c\.env\(`)
	if err != nil {
		return err
	}
	for _, path := range files {
		if !isSource(path, ".ts", ".mts", ".tsx") {
			continue
		}
		content, err := tree.Read(path)
		if err != nil {
			return err
		}
		found.addFile(path, content, constants(shared))
	}
	return nil
}

// addFile records one file's config leaves; shared holds the shared schemas.
func (r readings) addFile(path, content string, shared map[string]string) {
	defs := constants(content)
	for name, text := range shared {
		if _, own := defs[name]; !own {
			defs[name] = text
		}
	}
	for _, match := range tsRead.FindAllStringSubmatchIndex(content, -1) {
		call := callText(content, strings.Index(content[match[0]:], "(")+match[0])
		r.add(content[match[2]:match[3]], path, !isLenient(call, defs, 2))
	}
}

func goSettings(tree Tree, found readings) error {
	files, err := tree.Grep(`env:"`)
	if err != nil {
		return err
	}
	for _, path := range files {
		if !isSource(path, ".go") {
			continue
		}
		content, err := tree.Read(path)
		if err != nil {
			return err
		}
		for _, match := range goTag.FindAllStringSubmatch(content, -1) {
			required := strings.Contains(match[2], "required") || strings.Contains(match[2], "notEmpty") ||
				strings.Contains(match[0], `validate:"required`)
			found.add(match[1], path, required)
		}
	}
	return nil
}

// callText is the call whose argument list opens at open, through its closing parenthesis.
func callText(content string, open int) string {
	depth := 0
	for i := open; i < len(content); i++ {
		switch content[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return content[open : i+1]
			}
		}
	}
	return content[open:]
}

// constants maps each top-level const to its initialiser, up to the first blank line.
func constants(content string) map[string]string {
	defs := map[string]string{}
	for _, match := range constDef.FindAllStringSubmatchIndex(content, -1) {
		text := content[match[1]:]
		if end := strings.Index(text, "\n\n"); end >= 0 {
			text = text[:end]
		}
		defs[content[match[2]:match[3]]] = text
	}
	return defs
}

// isLenient is whether a schema accepts an unset variable, following named schemas depth deep.
func isLenient(text string, defs map[string]string, depth int) bool {
	if lenient.MatchString(text) {
		return true
	}
	if depth == 0 {
		return false
	}
	for _, name := range identifier.FindAllString(text, -1) {
		if def, ok := defs[name]; ok && isLenient(def, defs, depth-1) {
			return true
		}
	}
	return false
}

// isSource is whether path is product code in one of exts, not a test or fixture.
func isSource(path string, exts ...string) bool {
	for _, skip := range []string{"node_modules/", "__tests__/", "__fixtures__/", "testdata/", "tests/", "e2e/", ".test.", ".spec.", ".fixtures.", "_test.go"} {
		if strings.Contains(path, skip) {
			return false
		}
	}
	for _, ext := range exts {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}
