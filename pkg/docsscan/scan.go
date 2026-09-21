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
	"net/url"
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

// selfIdentifyingVersionPatterns name a LangWatch release on their own, so they
// need no surrounding context to be sure. Each has one capture group holding the
// version.
//
// The whole set of version rules is deliberately narrow: a rule that flagged
// every semver in the docs would fire on Kubernetes, Python and SDK versions,
// and a check that cries wolf gets switched off.
//
// Two boundaries matter here. The image names are listed rather than matched by
// a character class, so `langwatch/clickhouse-serverless:0.2.0` stays out — it is
// versioned independently of the chart, and widening this to `[a-z0-9_-]+`, the
// obvious-looking change, makes the rule fire on it every run. And the namespace
// is anchored, because a bare substring match reads
// `notlangwatch/langwatch:1.14.5` as ours.
var selfIdentifyingVersionPatterns = []*regexp.Regexp{
	regexp.MustCompile(namespaceStart + `langwatch/` + releaseImages + `:(\d+\.\d+\.\d+)`),
}

// releaseImages is the set of images whose tag tracks the chart's appVersion.
// `langwatch/clickhouse-serverless` is deliberately absent: it is versioned
// independently, so holding it to appVersion would report a correct reference as
// drift and tell the author to break it.
const releaseImages = `(?:langwatch|langwatch_nlp|langevals)`

// namespaceStart is what may precede the `langwatch/` namespace: the start of the
// line, or any character that cannot itself be part of a path component. Without
// it the patterns match by suffix, so `notlangwatch/langwatch` and
// `registry.example.com/notlangwatch/langwatch` would both count as ours.
const namespaceStart = `(?:^|[^A-Za-z0-9_.-])`

// imageTagPattern is an image tag in a Helm values block, `tag: "3.12.0"`.
//
// It is paired with its own `repository:` over a tight window rather than the
// wider chart context, because a `tag:` belongs to the repository directly above
// it. Judged against the wider context, a `tag: "0.2.0"` sitting under
// `repository: langwatch/clickhouse-serverless` was reported as drift.
var imageTagPattern = regexp.MustCompile(`^\s*tag:\s*"(\d+\.\d+\.\d+)"`)

// releaseRepository is a `repository:` naming an image that tracks the release.
//
// An optional registry host may precede the namespace, but `langwatch` has to be
// a whole path component: `registry.example.com/langwatch/langwatch` counts,
// `registry.example.com/notlangwatch/langwatch` does not.
var releaseRepository = regexp.MustCompile(
	`^\s*repository:\s*(?:[A-Za-z0-9_.:-]+/)?langwatch/` + releaseImages + `\s*$`,
)

// chartVersionPatterns are version forms that mean a LangWatch release only
// when the surrounding lines are about the LangWatch chart. On their own they
// are generic: `--version 1.14.5` in a cert-manager example would otherwise be
// reported as drift, with a remedy telling the author to change it to ours. A
// rule that fires on unrelated versions is a rule people switch off.
var chartVersionPatterns = []*regexp.Regexp{
	// The shell variable the mirroring example sets: VERSION=3.12.0
	regexp.MustCompile(`\bVERSION=(\d+\.\d+\.\d+)\b`),
	// A pinned chart release: `helm upgrade langwatch langwatch/langwatch
	// --version 3.12.0`. Without this the upgrade guides pinned a release nine
	// minors old while the checker reported the site sound.
	regexp.MustCompile(`--version[= ]\s*(\d+\.\d+\.\d+)\b`),
	// The chart revision an ArgoCD Application tracks. Readers copy these
	// manifests verbatim, so a stale one deploys a stale release.
	regexp.MustCompile(`^\s*targetRevision:\s*"?(\d+\.\d+\.\d+)"?`),
}

// chartContext marks a line as being about the LangWatch chart or one of its
// release-tracking images.
//
// Deliberately not `langwatch/langwatch` on its own: that appears in every
// `github.com/langwatch/langwatch` source link in the docs, which would make
// almost any page count as chart context.
var chartContext = regexp.MustCompile(
	// A tagged release image, including the mirroring loop's `langwatch/$image:`.
	namespaceStart + `langwatch/(?:` + releaseImages + `|\$\{?[a-z_]+\}?):` +
		// A Helm chart reference: `helm upgrade langwatch langwatch/langwatch`.
		// The preceding `\s+` is the namespace boundary here, so the chart ref has
		// to be its own argument — `notlangwatch/langwatch` cannot satisfy it.
		`|helm\s+\S+\s+\S+\s+langwatch/langwatch\b` +
		// An ArgoCD source. The host is exact: `notlangwatch.github.io` is not ours.
		`|chart:\s*langwatch\s*$` +
		`|repoURL:\s*https?://langwatch\.github\.io`,
)

// chartContextRule reaches both ways because the real shapes differ: a `helm
// upgrade langwatch langwatch/langwatch \` line precedes its `--version`
// continuation, while the mirroring example sets `VERSION=` above the loop that
// names the images.
var chartContextRule = contextRule{pattern: chartContext, window: 8}

// releaseRepositoryRule stays tight: a `tag:` sits directly under the
// `repository:` it belongs to.
var releaseRepositoryRule = contextRule{pattern: releaseRepository, window: 3}

// FindVersionRefs pulls every release version out of one page's contents.
func FindVersionRefs(file, contents string) []VersionRef {
	lines := strings.Split(contents, "\n")
	var refs []VersionRef
	for i, line := range lines {
		at := versionSite{file: file, index: i, line: line}
		refs = at.append(refs, selfIdentifyingVersionPatterns)
		if near(lines, i, chartContextRule) {
			refs = at.append(refs, chartVersionPatterns)
		}
		if near(lines, i, releaseRepositoryRule) {
			refs = at.append(refs, []*regexp.Regexp{imageTagPattern})
		}
	}
	return refs
}

// versionSite is one line of one page, the place a version can be written.
type versionSite struct {
	file  string
	index int
	line  string
}

func (s versionSite) append(refs []VersionRef, patterns []*regexp.Regexp) []VersionRef {
	for _, pattern := range patterns {
		for _, match := range pattern.FindAllStringSubmatch(s.line, -1) {
			refs = append(refs, VersionRef{
				File:    s.file,
				Line:    s.index + 1,
				Version: match[1],
			})
		}
	}
	return refs
}

// contextRule is a pattern that qualifies a version, together with how far away
// it may sit. The two travel together because the distance is a property of the
// shape: a `tag:` sits right under its `repository:`, while a `--version` can be
// several continuation lines from the chart it pins.
type contextRule struct {
	pattern *regexp.Regexp
	window  int
}

// near reports whether any line within the rule's window of lines[at] matches.
func near(lines []string, at int, rule contextRule) bool {
	from := max(at-rule.window, 0)
	to := min(at+rule.window, len(lines)-1)
	for i := from; i <= to; i++ {
		if rule.pattern.MatchString(lines[i]) {
			return true
		}
	}
	return false
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
		if isExternal(redirect.Destination) {
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
		// Mintlify's documented way to move a whole section is to carry the
		// wildcard through to the destination — `/old/:path*` → `/new/:path*`.
		// The destination is then a pattern rather than a page, so resolving it
		// against the page list would fail a redirect that is entirely correct.
		if hasPathParameter(redirect.Destination) {
			continue
		}
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

// isExternal reports whether a redirect destination leaves the docs site.
//
// This tests the scheme rather than a "http" prefix: a prefix test calls a
// protocol-relative `//host/path` internal, and calls an internal page whose
// slug happens to begin with those four letters external — which would quietly
// exempt it from both redirect rules.
func isExternal(destination string) bool {
	if strings.HasPrefix(destination, "//") {
		return true
	}
	parsed, err := url.Parse(destination)
	return err == nil && parsed.Scheme != ""
}

// hasPathParameter reports whether a redirect path is a pattern rather than a
// concrete page — `/old/:path*`, `/x/:slug`.
func hasPathParameter(path string) bool {
	return strings.Contains(path, "/:")
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
