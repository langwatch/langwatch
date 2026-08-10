// Package docsscan holds the rules for the docs site's structural integrity —
// the ones the Mintlify CLI does not cover.
//
// `mint validate` checks that the build succeeds and `mint broken-links
// --check-redirects` checks that a redirect destination resolves. Neither one
// looks for a page that exists but no longer appears in the navigation, and
// neither one notices that a redirect points at another redirect's source.
// Mintlify serves an unreferenced page at its URL regardless of the navigation,
// so an orphan is not a dead file: it is a live page nobody is maintaining.
// That is how three internal engineering notes came to be published.
package docsscan

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Kind names a rule. Callers switch on it, so the values are stable.
type Kind string

const (
	// OrphanPage is a content file that the navigation never references. It is
	// still served at its URL.
	OrphanPage Kind = "orphan-page"
	// MissingPage is a navigation entry with no file behind it.
	MissingPage Kind = "missing-page"
	// DuplicateNavEntry is one page reachable from two places in the sidebar.
	DuplicateNavEntry Kind = "duplicate-nav-entry"
	// AbsoluteNavPath is a navigation entry written with a leading slash. The
	// rest of the file omits it, and the two forms are not interchangeable
	// everywhere.
	AbsoluteNavPath Kind = "absolute-nav-path"
	// RedirectChain is a redirect whose destination is another redirect's
	// source. Mintlify does not follow more than one hop, so the reader lands
	// on the intermediate path.
	RedirectChain Kind = "redirect-chain"
	// RedirectDeadEnd is a redirect whose destination is neither a page nor
	// another redirect's source.
	RedirectDeadEnd Kind = "redirect-dead-end"
	// VersionDrift is a release version in the docs that no longer matches the
	// chart's appVersion.
	VersionDrift Kind = "version-drift"
)

// Finding is one rule violation, with the remedy spelled out. Problem says what
// is wrong; Fix says what to do about it, because a checker that only reports
// is a checker people learn to ignore.
type Finding struct {
	Kind    Kind   `json:"kind"`
	Where   string `json:"where"`
	Problem string `json:"problem"`
	Fix     string `json:"fix"`
}

// Redirect is one docs.json redirect entry.
type Redirect struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
}

// VersionRef is one release version written into a docs page.
type VersionRef struct {
	// File is the repository-relative path of the page.
	File string
	// Line is the 1-indexed line the version sits on.
	Line int
	// Version is the semver as written.
	Version string
}

// Inputs is everything the rules need, already read. Keeping the rules pure
// means they are unit-testable without a docs tree on disk.
type Inputs struct {
	// NavPages is every page reference in the navigation, in document order and
	// including duplicates, exactly as docs.json spells them.
	NavPages []string
	// ContentPages is every page on disk that Mintlify would serve, as a slug
	// with no extension (for example "self-hosting/overview").
	ContentPages []string
	// Redirects is docs.json's redirects array.
	Redirects []Redirect
	// VersionRefs is every release version found in the pages.
	VersionRefs []VersionRef
	// ChartVersion is the chart's appVersion, the release the docs should name.
	ChartVersion string
}

// versionPatterns are the ways a LangWatch release version appears in a page.
// Each one has a capture group holding the version.
//
// The set is deliberately narrow. A rule that flagged every semver in the docs
// would fire on Kubernetes versions, Python versions and SDK versions, and a
// check that cries wolf gets switched off.
var versionPatterns = []*regexp.Regexp{
	// A tagged LangWatch image: langwatch/langwatch_nlp:3.12.0
	regexp.MustCompile(`langwatch/[a-z_]+:(\d+\.\d+\.\d+)`),
	// An image tag in a Helm values block, for example `tag: "3.12.0"`.
	regexp.MustCompile(`^\s*tag:\s*"(\d+\.\d+\.\d+)"`),
	// The shell variable the mirroring example sets: VERSION=3.12.0
	regexp.MustCompile(`\bVERSION=(\d+\.\d+\.\d+)\b`),
}

// FindVersionRefs pulls every release version out of one page's contents.
func FindVersionRefs(file, contents string) []VersionRef {
	var refs []VersionRef
	for i, line := range strings.Split(contents, "\n") {
		for _, pattern := range versionPatterns {
			for _, match := range pattern.FindAllStringSubmatch(line, -1) {
				refs = append(refs, VersionRef{File: file, Line: i + 1, Version: match[1]})
			}
		}
	}
	return refs
}

// Check runs every rule and returns the findings, ordered by kind and then by
// location so the output is stable between runs.
func Check(in Inputs) []Finding {
	var findings []Finding
	findings = append(findings, checkNav(in)...)
	findings = append(findings, checkRedirects(in)...)
	findings = append(findings, checkVersions(in)...)

	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Kind != findings[j].Kind {
			return findings[i].Kind < findings[j].Kind
		}
		return findings[i].Where < findings[j].Where
	})
	return findings
}

// navIndex is the navigation reduced to what the rules ask of it: how many
// times each page is referenced, and the order those pages were first met, so
// the findings come out in document order rather than map order.
type navIndex struct {
	count map[string]int
	order []string
}

func indexNav(entries []string) navIndex {
	index := navIndex{count: make(map[string]int, len(entries))}
	for _, entry := range entries {
		slug := strings.TrimPrefix(entry, "/")
		if index.count[slug] == 0 {
			index.order = append(index.order, slug)
		}
		index.count[slug]++
	}
	return index
}

func setOf(items []string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[item] = true
	}
	return set
}

func checkNav(in Inputs) []Finding {
	index := indexNav(in.NavPages)
	var findings []Finding
	findings = append(findings, checkAbsolutePaths(in.NavPages)...)
	findings = append(findings, checkEntries(index, setOf(in.ContentPages))...)
	findings = append(findings, checkOrphans(in.ContentPages, index)...)
	return findings
}

func checkAbsolutePaths(entries []string) []Finding {
	var findings []Finding
	for _, entry := range entries {
		if !strings.HasPrefix(entry, "/") {
			continue
		}
		findings = append(findings, Finding{
			Kind:    AbsoluteNavPath,
			Where:   entry,
			Problem: "navigation entry starts with a slash, unlike every other entry",
			Fix:     "drop the leading slash",
		})
	}
	return findings
}

func checkEntries(index navIndex, content map[string]bool) []Finding {
	var findings []Finding
	for _, slug := range index.order {
		if !content[slug] {
			findings = append(findings, Finding{
				Kind:    MissingPage,
				Where:   slug,
				Problem: "navigation entry has no .mdx or .md file",
				Fix:     "create the page, or remove the entry from docs.json",
			})
		}
		if index.count[slug] > 1 {
			findings = append(findings, Finding{
				Kind:    DuplicateNavEntry,
				Where:   slug,
				Problem: fmt.Sprintf("appears in the navigation %d times", index.count[slug]),
				Fix:     "keep the entry in the group it belongs to and delete the others",
			})
		}
	}
	return findings
}

func checkOrphans(pages []string, index navIndex) []Finding {
	var findings []Finding
	for _, page := range pages {
		if index.count[page] > 0 {
			continue
		}
		findings = append(findings, Finding{
			Kind:  OrphanPage,
			Where: page,
			Problem: "page is not in the navigation, but Mintlify still serves it " +
				"at its URL, so it is published and unmaintained",
			Fix: "add it to docs.json, or delete it — and if it is an internal " +
				"note, move it under dev/docs/ where it is not published",
		})
	}
	return findings
}

func checkRedirects(in Inputs) []Finding {
	var findings []Finding

	sources := make(map[string]bool, len(in.Redirects))
	for _, redirect := range in.Redirects {
		sources[redirect.Source] = true
	}
	content := setOf(in.ContentPages)

	for _, redirect := range in.Redirects {
		where := redirect.Source + " -> " + redirect.Destination
		// An off-site destination is somebody else's to keep working.
		if strings.HasPrefix(redirect.Destination, "http") {
			continue
		}
		if sources[redirect.Destination] {
			findings = append(findings, Finding{
				Kind:    RedirectChain,
				Where:   where,
				Problem: "destination is itself a redirect source, and Mintlify does not follow two hops",
				Fix:     "point this redirect at the page the chain ends on",
			})
			continue
		}
		// A wildcard redirect's destination is a concrete page; the source
		// pattern is what carries the :path* or :splat.
		if !content[strings.TrimPrefix(redirect.Destination, "/")] {
			findings = append(findings, Finding{
				Kind:    RedirectDeadEnd,
				Where:   where,
				Problem: "destination is not a page and not another redirect's source",
				Fix:     "point it at a page that exists",
			})
		}
	}

	return findings
}

func checkVersions(in Inputs) []Finding {
	if in.ChartVersion == "" {
		return nil
	}
	var findings []Finding
	for _, ref := range in.VersionRefs {
		if ref.Version == in.ChartVersion {
			continue
		}
		findings = append(findings, Finding{
			Kind:  VersionDrift,
			Where: fmt.Sprintf("%s:%d", ref.File, ref.Line),
			Problem: fmt.Sprintf(
				"names release %s, but the chart ships %s",
				ref.Version, in.ChartVersion,
			),
			Fix: fmt.Sprintf("update it to %s", in.ChartVersion),
		})
	}
	return findings
}
