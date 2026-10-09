package docscheck

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/docsscan"
)

// docsConfig is the part of docs.json the checks read. Navigation is held as
// raw JSON because the shape is recursive and open-ended — anchors hold tabs
// hold groups hold groups — and the checks only need the page strings, so
// walking the tree generically is both shorter and immune to a new division
// being introduced upstream.
type docsConfig struct {
	Navigation json.RawMessage     `json:"navigation"`
	Redirects  []docsscan.Redirect `json:"redirects"`
}

// pageExtensions are the extensions Mintlify serves as a page.
var pageExtensions = []string{".mdx", ".md"}

// nonContentDirs are directories under docs/ that hold no servable pages.
// Snippets are included by other pages rather than served, and the rest are
// assets or tooling.
var nonContentDirs = map[string]bool{
	"snippets":     true,
	"images":       true,
	"logo":         true,
	"media":        true,
	"scripts":      true,
	"node_modules": true,
}

// appVersion pulls appVersion out of a Helm Chart.yaml. The chart is small and
// the field is one line, so a line scan avoids taking a YAML dependency into a
// tool that needs nothing else from it.
var appVersion = regexp.MustCompile(`(?m)^appVersion:\s*"?(\d+\.\d+\.\d+)"?`)

// Load reads everything the rules need from the repository at root.
func Load(root, docsDir, chartPath string) (docsscan.Inputs, error) {
	var in docsscan.Inputs

	docsRoot := filepath.Join(root, docsDir)
	raw, err := os.ReadFile(filepath.Join(docsRoot, "docs.json"))
	if err != nil {
		return in, fmt.Errorf("read docs.json: %w", err)
	}
	var config docsConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return in, fmt.Errorf("parse docs.json: %w", err)
	}
	in.Redirects = config.Redirects
	in.NavPages, err = collectNavPages(config.Navigation)
	if err != nil {
		return in, fmt.Errorf("read navigation from docs.json: %w", err)
	}
	// Without this, an unreadable or absent navigation reads as "no page is
	// referenced", and the orphan rule then reports every page on the site.
	// Hundreds of findings whose real cause is one missing key is worse than no
	// check at all, so this exits 2 rather than 1.
	if len(in.NavPages) == 0 {
		return in, errors.New(
			"docs.json navigation references no pages at all — expected a `navigation` " +
				"key holding groups of `pages`; refusing to report every page as an orphan",
		)
	}

	pages, refs, err := walkContent(docsRoot, docsDir)
	if err != nil {
		return in, err
	}
	in.ContentPages = pages
	in.VersionRefs = refs

	chart, err := os.ReadFile(filepath.Join(root, chartPath))
	if err != nil {
		return in, fmt.Errorf("read chart: %w", err)
	}
	if match := appVersion.FindSubmatch(chart); match != nil {
		in.ChartVersion = string(match[1])
	} else {
		return in, fmt.Errorf("no appVersion in %s", chartPath)
	}

	return in, nil
}

// collectNavPages walks the navigation tree and returns every page string,
// duplicates included. A string anywhere under a "pages" key is a page
// reference; anything else is structure. Walking generically keeps this immune
// to a new navigation division being introduced upstream.
//
// The order is not meaningful: Go randomizes map iteration, so a group's
// position in the result varies between runs. Nothing may depend on it — Check
// sorts the findings it produces, which is what keeps the report stable.
func collectNavPages(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 {
		return nil, errors.New("no `navigation` key")
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	return appendNavPages(nil, root, false), nil
}

func appendNavPages(pages []string, node any, inPages bool) []string {
	switch value := node.(type) {
	case map[string]any:
		for key, child := range value {
			pages = appendNavPages(pages, child, key == "pages")
		}
	case []any:
		for _, child := range value {
			pages = appendNavPages(pages, child, inPages)
		}
	case string:
		if inPages {
			pages = append(pages, value)
		}
	}
	return pages
}

// contentPage is one servable page, held as both the slug Mintlify serves it
// under and the path to read it from.
type contentPage struct {
	slug string
	path string
	// rel is the path relative to the docs directory, for reporting.
	rel string
}

// walkContent returns every servable page as a slug, plus every release version
// written into those pages.
//
// The walk collects paths and the reading happens afterwards rather than in the
// callback: a filesystem operation on a path handed to a WalkDir callback is
// open to symlink TOCTOU (gosec G122), and separating the two also keeps each
// half simple enough to follow.
func walkContent(docsRoot, docsDir string) ([]string, []docsscan.VersionRef, error) {
	found, err := findContentPages(docsRoot)
	if err != nil {
		return nil, nil, fmt.Errorf("walk %s: %w", docsDir, err)
	}

	slugs := make([]string, 0, len(found))
	var refs []docsscan.VersionRef
	for _, page := range found {
		slugs = append(slugs, page.slug)
		contents, err := os.ReadFile(page.path)
		if err != nil {
			return nil, nil, fmt.Errorf("read %s: %w", page.rel, err)
		}
		refs = append(refs, docsscan.FindVersionRefs(
			filepath.ToSlash(filepath.Join(docsDir, page.rel)),
			string(contents),
		)...)
	}
	return slugs, refs, nil
}

func findContentPages(docsRoot string) ([]contentPage, error) {
	var found []contentPage
	err := filepath.WalkDir(docsRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(docsRoot, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return skipNonContentDir(rel, entry)
		}
		if !isContentFile(entry) {
			return nil
		}
		extension := filepath.Ext(rel)
		found = append(found, contentPage{
			slug: filepath.ToSlash(strings.TrimSuffix(rel, extension)),
			path: path,
			rel:  rel,
		})
		return nil
	})
	return found, err
}

func skipNonContentDir(rel string, entry fs.DirEntry) error {
	if rel == "." {
		return nil
	}
	if nonContentDirs[rel] || strings.HasPrefix(entry.Name(), ".") {
		return fs.SkipDir
	}
	return nil
}

func isContentFile(entry fs.DirEntry) bool {
	extension := filepath.Ext(entry.Name())
	if !slices.Contains(pageExtensions, extension) {
		return false
	}
	// A README is repository documentation, not a published page.
	return !strings.EqualFold(entry.Name(), "README"+extension)
}
