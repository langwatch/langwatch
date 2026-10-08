// Package readmegen writes the generated block of every module, app and
// package README from the code: Go reads the catalogue, package.json files
// and the Prisma schema; an embedded TypeScript extractor reads declarations.
// Plan: dev/docs/plans/module-readmes-2026-10-06.md.
package readmegen

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type options struct {
	root     string
	write    bool
	check    bool
	only     string
	manifest string
	stdout   io.Writer
	stderr   io.Writer
}

// Run is the command line: exactly one of --write or --check.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("readmegen", flag.ContinueOnError)
	flags.SetOutput(stderr)
	opts := options{stdout: stdout, stderr: stderr}
	flags.StringVar(&opts.root, "root", ".", "workspace root (holds modules/catalogue.json)")
	flags.BoolVar(&opts.write, "write", false, "rewrite every stale page")
	flags.BoolVar(&opts.check, "check", false, "exit 1 with a diff when a page is stale or undescribed")
	flags.StringVar(&opts.only, "only", "", "only pages whose path starts with this prefix")
	flags.StringVar(&opts.manifest, "manifest", "", "read the extractor manifest from this file instead of running node")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if opts.write == opts.check {
		fmt.Fprintln(stderr, "readmegen: pass exactly one of --write or --check")
		return 2
	}
	if err := run(context.Background(), opts); err != nil {
		var stale errStale
		if !errors.As(err, &stale) {
			fmt.Fprintln(stderr, "readmegen:", err)
		}
		return 1
	}
	return 0
}

// errStale is a check that found work: the pages already printed why.
type errStale struct{ count int }

func (e errStale) Error() string { return fmt.Sprintf("%d pages need attention", e.count) }

func run(ctx context.Context, opts options) error {
	stderr := opts.stderr
	root, err := filepath.Abs(opts.root)
	if err != nil {
		return err
	}
	ws, err := loadWorkspace(root)
	if err != nil {
		return err
	}
	manifest, err := loadManifest(ctx, opts, root)
	if err != nil {
		return err
	}
	if errs := manifest.Schemas.Errors; len(errs) > 0 {
		return fmt.Errorf("the zod schemas could not be read (%d imports failed; first: %s); "+
			"prepare the workspace with `pnpm start:prepare:files` and `pnpm ensure:built`, then rerun", len(errs), errs[0])
	}
	reportUnresolved(manifest, stderr)
	disagreements := crossCheck(manifest, stderr)
	target := settleTarget{root: root, check: opts.check, stdout: opts.stdout, stderr: stderr}
	problems, err := settleAll(newGenerator(ws, manifest).pages(), opts.only, target)
	if err != nil {
		return err
	}
	problems += disagreements + reportGroups(ws, packageGroups, stderr)
	if opts.check && problems > 0 {
		fmt.Fprintf(stderr, "readmegen: %d pages need attention; run `pnpm generate:readmes` and describe each page above its block\n", problems)
		return errStale{problems}
	}
	return nil
}

func loadManifest(ctx context.Context, opts options, root string) (Manifest, error) {
	if opts.manifest != "" {
		return readManifest(opts.manifest)
	}
	return runExtractor(ctx, root, opts.stderr)
}

// settleAll settles every page under the prefix and counts those needing attention.
func settleAll(pages []page, only string, target settleTarget) (int, error) {
	problems := 0
	for _, p := range pages {
		if !strings.HasPrefix(p.Path, only) {
			continue
		}
		bad, err := settle(p, target)
		if err != nil {
			return problems, err
		}
		if bad {
			problems++
		}
	}
	return problems, nil
}

// settleTarget is where pages are settled and how: written, or only checked.
type settleTarget struct {
	root           string
	check          bool
	stdout, stderr io.Writer
}

// settle writes or checks one page; it reports whether the page needs attention.
func settle(p page, target settleTarget) (bool, error) {
	stdout, stderr := target.stdout, target.stderr
	file := filepath.Join(target.root, filepath.FromSlash(p.Path))
	existing, err := os.ReadFile(file) // #nosec G304 -- a README path the generator owns
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	next := splice(string(existing), p)
	undescribed := !described(next)
	if undescribed {
		fmt.Fprintf(stderr, "%s: describe %s in a paragraph above the generated block\n", p.Path, p.Title)
	}
	if next == string(existing) {
		return undescribed, nil
	}
	if target.check {
		fmt.Fprint(stdout, unifiedDiff(p.Path, string(existing), next))
		return true, nil
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
		return false, err
	}
	if err := os.WriteFile(file, []byte(next), 0o600); err != nil { // #nosec G703 -- a README path the generator owns
		return false, err
	}
	fmt.Fprintf(stdout, "Wrote %s\n", p.Path)
	return undescribed, nil
}

func reportUnresolved(manifest Manifest, stderr io.Writer) {
	counts := unresolvedCounts(manifest)
	if len(counts) == 0 {
		return
	}
	kinds := make([]string, 0, len(counts))
	for kind := range counts {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	parts := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		parts = append(parts, fmt.Sprintf("%d %s", counts[kind], kind))
	}
	fmt.Fprintf(stderr, "readmegen: unresolved values (shown with ≈): %s\n", strings.Join(parts, ", "))
}
