package shapemod

import (
	"regexp"
	"strings"
)

// foldBlock is one exported declaration out of a ports/*.port.ts file, ready
// to be appended to the module's infrastructure file.
type foldBlock struct {
	Kind string // "interface" (copied as is), "type" (copied as is), "classToInterface"
	Name string
	Text string // final text, doc comment included, ending in a newline
}

// fileFoldPlan is the whole-file verdict: FOLD moves every block in Blocks
// into the infrastructure file, SKIP leaves the file exactly as it is.
type fileFoldPlan struct {
	Path    string
	Status  string // "FOLD" or "SKIP"
	Reason  string
	Blocks  []foldBlock
	Imports []carriedImport // deduplicated, non-relative or non-sibling-port imports the blocks still need
}

var exportHeadRe = regexp.MustCompile(`(?m)^export\s+(?:(abstract)\s+)?(class|interface|type)\s+(\w+)`)

// planFileFold parses every top-level export in content and decides whether
// the whole file can fold. A file folds only when every export is a plain
// interface, a plain type alias, or a fully-abstract class (no constructor,
// no concrete method body, no initialised field, no extends clause) - see
// README "infra" for the rationale: a mixed file (a concrete class, an
// abstract class with real behaviour) cannot become a pure interface without
// a person dividing it first.
func planFileFold(path, content string) fileFoldPlan {
	heads := exportHeadRe.FindAllStringSubmatchIndex(content, -1)
	if len(heads) == 0 {
		return fileFoldPlan{Path: path, Status: "SKIP", Reason: "no exported class/interface/type found"}
	}

	plan := fileFoldPlan{Path: path, Status: "FOLD"}
	for _, m := range heads {
		headStart := m[0]
		abstract := m[2] != -1
		kind := content[m[4]:m[5]]
		name := content[m[6]:m[7]]
		afterName := m[7]
		docStart := leadingDocStart(content, headStart)

		switch kind {
		case "type":
			end := findTypeAliasEnd(content, afterName)
			plan.Blocks = append(plan.Blocks, foldBlock{
				Kind: "type", Name: name, Text: strings.TrimRight(content[docStart:end], "\n") + "\n",
			})
			continue
		case "interface":
			end, body := findBraceBody(content, afterName)
			_ = body
			plan.Blocks = append(plan.Blocks, foldBlock{
				Kind: "interface", Name: name, Text: strings.TrimRight(content[docStart:end], "\n") + "\n",
			})
			continue
		case "class":
			if !abstract {
				return fileFoldPlan{Path: path, Status: "SKIP",
					Reason: "exports a concrete class " + name + "; not interface/type/abstract-class shaped"}
			}
			headerTail := strings.TrimSpace(content[afterName:findBraceOpen(content, afterName)])
			if strings.Contains(headerTail, "extends") {
				return fileFoldPlan{Path: path, Status: "SKIP",
					Reason: "abstract class " + name + " extends a base type; needs a person to divide it first"}
			}
			end, body := findBraceBody(content, afterName)
			if reason, ok := concreteBodyReason(body); ok {
				return fileFoldPlan{Path: path, Status: "SKIP",
					Reason: "abstract class " + name + " " + reason}
			}
			iface := "export interface " + name + " {" + stripAbstractKeyword(body) + "}\n"
			doc := content[docStart:headStart]
			plan.Blocks = append(plan.Blocks, foldBlock{
				Kind: "classToInterface", Name: name, Text: strings.TrimRight(doc, "\n") + "\n" + iface,
			})
			_ = end
		}
	}
	return plan
}

// findBraceOpen returns the index of the first '{' at or after from.
func findBraceOpen(content string, from int) int {
	idx := strings.IndexByte(content[from:], '{')
	if idx == -1 {
		return len(content)
	}
	return from + idx
}

// findBraceBody returns the index just past the matching closing brace, and
// the body text strictly between the braces, for the first brace pair at or
// after from.
func findBraceBody(content string, from int) (end int, body string) {
	open := findBraceOpen(content, from)
	depth := 0
	for i := open; i < len(content); i++ {
		switch content[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1, content[open+1 : i]
			}
		}
	}
	return len(content), content[open+1:]
}

// findTypeAliasEnd returns the index just past the terminating top-level ';'
// of a `type Name = ...;` alias starting its '=' search at from.
func findTypeAliasEnd(content string, from int) int {
	depth := 0
	for i := from; i < len(content); i++ {
		switch content[i] {
		case '{', '(', '[':
			depth++
		case '}', ')', ']':
			depth--
		case ';':
			if depth <= 0 {
				return i + 1
			}
		}
	}
	return len(content)
}

var constructorRe = regexp.MustCompile(`(?m)^\s*(?:private\s+|protected\s+|public\s+)?constructor\s*\(`)
var initialisedFieldRe = regexp.MustCompile(`(?m)^\s*(?:private|protected|public|readonly|static)(?:\s+(?:private|protected|public|readonly|static))*\s+\w+\s*(?::\s*[^=;{]+)?=[^=]`)

// concreteBodyReason reports why an abstract class's body cannot fold to a
// plain interface: a constructor, a concrete (non-abstract) method, or a
// field carrying an initial value.
func concreteBodyReason(body string) (string, bool) {
	if constructorRe.MatchString(body) {
		return "declares a constructor", true
	}
	if hasConcreteMethod(body) {
		return "declares a concrete method body", true
	}
	if initialisedFieldRe.MatchString(body) {
		return "declares an initialised field", true
	}
	return "", false
}

var abstractMemberRe = regexp.MustCompile(`(?m)^(\s*)abstract\s+`)

// stripAbstractKeyword drops the leading "abstract " modifier from every
// member line, turning an abstract-class body into a valid interface body.
func stripAbstractKeyword(body string) string {
	return abstractMemberRe.ReplaceAllString(body, "$1")
}

// leadingDocStart returns the offset of the JSDoc/line-comment block that
// immediately precedes headStart (only whitespace in between), or headStart
// itself when there is none.
func leadingDocStart(content string, headStart int) int {
	j := headStart
	for j > 0 {
		c := content[j-1]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			j--
			continue
		}
		break
	}
	if j == 0 {
		return headStart
	}
	if strings.HasSuffix(content[:j], "*/") {
		if open := strings.LastIndex(content[:j], "/*"); open != -1 {
			return open
		}
	}
	lineStart := j
	for {
		ls := strings.LastIndexByte(content[:lineStart], '\n') + 1
		line := strings.TrimSpace(content[ls:lineStart])
		if strings.HasPrefix(line, "//") {
			lineStart = ls
			continue
		}
		break
	}
	if lineStart != j {
		return lineStart
	}
	return headStart
}

// refersToType reports whether ifaceBody already names typeName as a member
// type (a plain word match is enough at this granularity: the infrastructure
// interfaces in this repo are short, hand-authored bodies).
func refersToType(ifaceBody, typeName string) bool {
	if ifaceBody == "" {
		return false
	}
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(typeName) + `\b`)
	return re.MatchString(ifaceBody)
}

// interfaceBodyOf returns the body text of the named interface in content,
// or "" when content is empty or the interface isn't declared yet.
func interfaceBodyOf(content, name string) string {
	if content == "" {
		return ""
	}
	re := interfaceDeclRe(name)
	loc := re.FindStringIndex(content)
	if loc == nil {
		return ""
	}
	_, body := findBraceBody(content, loc[1])
	return body
}
