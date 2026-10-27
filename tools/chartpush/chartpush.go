// Package chartpush pushes already-packaged Helm charts to an OCI registry and
// reads back the digest each push produced, for a deploy to pin.
//
// prerelease-charts-oci.yml packages each chart once and pushes it to GHCR;
// this pushes the same file to the artifacts ECR, so LangWatch Cloud pulls
// its prereleases from the registry its images already come from.
//
// Spec: specs/ci/publish-prerelease-charts-to-ecr.feature
package chartpush

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// Repository is the registry path every chart is pushed under.
const Repository = "langwatch-charts"

// Pusher pushes one package to an OCI reference and returns helm's output.
type Pusher func(ctx context.Context, packagePath, ref string) (string, error)

// Options names what to push and where.
type Options struct {
	Registry    string
	Charts      []string
	PackagesDir string
	Push        Pusher
}

// Result is one pushed chart.
type Result struct {
	Chart   string
	Version string
	Digest  string
	// Output is what helm printed, kept for the run log.
	Output string
}

// SummaryLine is the run-summary entry the deploy pins from.
func (r Result) SummaryLine() string {
	return fmt.Sprintf("- ECR %#q %#q", Repository+"/"+r.Chart+":"+r.Version, r.Digest)
}

var digestLine = regexp.MustCompile(`(?m)^Digest:\s*(\S+)`)
var wellFormedDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// Push pushes each chart in order and stops at the first failure, so no digest
// is reported for a chart the registry did not accept.
func Push(ctx context.Context, opts Options) ([]Result, error) {
	results := make([]Result, 0, len(opts.Charts))
	for _, chart := range opts.Charts {
		result, err := pushOne(ctx, opts, chart)
		if err != nil {
			return results, err
		}
		results = append(results, result)
	}
	return results, nil
}

func pushOne(ctx context.Context, opts Options, chart string) (Result, error) {
	pkg, err := findPackage(opts.PackagesDir, chart)
	if err != nil {
		return Result{}, err
	}
	ref := fmt.Sprintf("oci://%s/%s", opts.Registry, Repository)
	output, err := opts.Push(ctx, pkg, ref)
	if err != nil {
		return Result{}, fmt.Errorf("helm could not push %s to the artifacts registry: %w\n%s", chart, err, output)
	}
	digest := ""
	if m := digestLine.FindStringSubmatch(output); m != nil {
		digest = m[1]
	}
	if !wellFormedDigest.MatchString(digest) {
		return Result{}, fmt.Errorf("unexpected digest %q for %s; the deploy pins this value\n%s", digest, chart, output)
	}
	version := strings.TrimPrefix(strings.TrimSuffix(filepath.Base(pkg), ".tgz"), chart+"-")
	return Result{Chart: chart, Version: version, Digest: digest, Output: output}, nil
}

func findPackage(dir, chart string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, chart+"-*.tgz"))
	if err != nil {
		return "", err
	}
	if len(matches) != 1 {
		return "", fmt.Errorf("expected one packaged %s chart, found %d", chart, len(matches))
	}
	return matches[0], nil
}
