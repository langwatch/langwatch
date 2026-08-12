package linkcheck

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Fetcher answers with the final status code for a URL, having followed any
// redirects. Tests substitute one; the CLI uses HTTPFetcher.
type Fetcher func(ctx context.Context, url string) (int, error)

// Result is one distinct target's outcome.
type Result struct {
	Link
	Kind    Kind
	Status  int
	Verdict Verdict
	Detail  string
}

// Checker resolves a document's links.
type Checker struct {
	// RepoRoot anchors root-relative targets.
	RepoRoot string
	// Fetch resolves URLs. Nil checks repository paths only, which is what
	// -offline gives you.
	Fetch Fetcher
}

// Run checks every link in document, which was read from docPath. Each
// distinct target is resolved once however many times the README links it,
// and results come back in the order the targets first appear.
func (c Checker) Run(ctx context.Context, docPath, document string) []Result {
	seen := make(map[string]bool)
	var results []Result

	for _, link := range Extract(document) {
		kind := Classify(link.Target)
		if kind == Ignored || seen[link.Target] {
			continue
		}
		seen[link.Target] = true

		if result, checked := c.resolve(ctx, docPath, link); checked {
			results = append(results, result)
		}
	}
	return results
}

// resolve reports one link's outcome. The second return is false for a link
// nothing looked at, which is a URL under -offline.
func (c Checker) resolve(ctx context.Context, docPath string, link Link) (Result, bool) {
	kind := Classify(link.Target)
	result := Result{Link: link, Kind: kind}

	if kind == RepoPath {
		result.Verdict, result.Detail = c.checkPath(docPath, link.Target)
		return result, true
	}
	if c.Fetch == nil {
		return Result{}, false
	}

	status, err := c.Fetch(ctx, link.Target)
	result.Status = status
	result.Verdict = VerdictFor(status, err)
	if err != nil {
		result.Detail = err.Error()
	}
	return result, true
}

func (c Checker) checkPath(docPath, target string) (Verdict, string) {
	clean := target
	for _, sep := range []string{"#", "?"} {
		clean, _, _ = strings.Cut(clean, sep)
	}
	if clean == "" {
		return OK, ""
	}

	var resolved string
	if fromRoot, isRootRelative := strings.CutPrefix(clean, "/"); isRootRelative {
		resolved = filepath.Join(c.RepoRoot, filepath.FromSlash(fromRoot))
	} else {
		resolved = filepath.Join(filepath.Dir(docPath), filepath.FromSlash(clean))
	}

	if _, err := os.Stat(resolved); err != nil {
		relative, relErr := filepath.Rel(c.RepoRoot, resolved)
		if relErr != nil {
			relative = resolved
		}
		return Dead, fmt.Sprintf("no such path in the repository: %s", relative)
	}
	return OK, ""
}

// HTTPFetcher issues a GET, follows redirects, and retries once on a
// transport error so a single dropped connection does not read as a finding.
//
// It is a GET rather than a HEAD because enough hosts answer HEAD with 405 or
// 404 while serving the page perfectly well, and a HEAD-only checker reports
// those as broken links.
func HTTPFetcher(timeout time.Duration) Fetcher {
	client := &http.Client{Timeout: timeout}

	return func(ctx context.Context, url string) (int, error) {
		status, err := fetchOnce(ctx, client, url)
		if err == nil {
			return status, nil
		}
		if waitErr := pause(ctx, retryDelay); waitErr != nil {
			return 0, err
		}
		return fetchOnce(ctx, client, url)
	}
}

const retryDelay = time.Second

func fetchOnce(ctx context.Context, client *http.Client, url string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set("User-Agent", "langwatch-linkcheck (+https://github.com/langwatch/langwatch)")
	request.Header.Set("Accept", "*/*")

	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	response.Body.Close()

	return response.StatusCode, nil
}

func pause(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
