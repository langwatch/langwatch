package linkcheck_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/linkcheck"
)

func targets(results []linkcheck.Result) []string {
	found := make([]string, 0, len(results))
	for _, result := range results {
		found = append(found, result.Target)
	}
	return found
}

func verdictOf(t *testing.T, results []linkcheck.Result, target string) linkcheck.Result {
	t.Helper()
	for _, result := range results {
		if result.Target == target {
			return result
		}
	}
	t.Fatalf("no result for %q, got %v", target, targets(results))
	return linkcheck.Result{}
}

// @scenario "Links inside HTML in the README are checked too"
func TestExtractFindsMarkdownAndHTMLLinks(t *testing.T) {
	document := "" +
		"[docs](https://docs.langwatch.ai)\n" +
		"<a href=\"https://langwatch.ai\">site</a>\n" +
		"<img src=\"https://img.shields.io/badge\" alt=\"badge\" />\n"

	links := linkcheck.Extract(document)

	want := []string{"https://docs.langwatch.ai", "https://langwatch.ai", "https://img.shields.io/badge"}
	if len(links) != len(want) {
		t.Fatalf("got %d links, want %d: %+v", len(links), len(want), links)
	}
	for index, expected := range want {
		if links[index].Target != expected {
			t.Errorf("link %d: got %q, want %q", index, links[index].Target, expected)
		}
		if links[index].Line != index+1 {
			t.Errorf("link %d: got line %d, want %d", index, links[index].Line, index+1)
		}
	}
}

func TestClassifyIgnoresWhatCannotBeResolved(t *testing.T) {
	for target, want := range map[string]linkcheck.Kind{
		"#section":                       linkcheck.Ignored,
		"mailto:security@langwatch.ai":   linkcheck.Ignored,
		"http://localhost:5560":          linkcheck.Ignored,
		"https://docs.langwatch.ai/x":    linkcheck.URL,
		"/LICENSE.md":                    linkcheck.RepoPath,
		"platform/app/ee/LICENSE.md":     linkcheck.RepoPath,
		"/platform/app/ee/":              linkcheck.RepoPath,
		"tel:+310000000":                 linkcheck.Ignored,
		"https://langwatch.ai/pricing#x": linkcheck.URL,
	} {
		if got := linkcheck.Classify(target); got != want {
			t.Errorf("Classify(%q) = %v, want %v", target, got, want)
		}
	}
}

func TestVerdictForGradesAnswers(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		status int
		err    error
		want   linkcheck.Verdict
	}{
		{name: "a rate limit does not fail", status: http.StatusTooManyRequests, want: linkcheck.Unverified},
		{name: "a server error does not fail", status: http.StatusBadGateway, want: linkcheck.Unverified},
		{name: "a live page passes", status: http.StatusOK, want: linkcheck.OK},
		{name: "a transport error does not fail", err: errors.New("timeout"), want: linkcheck.Unverified},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := linkcheck.VerdictFor(testCase.status, testCase.err); got != testCase.want {
				t.Errorf("got %v, want %v", got, testCase.want)
			}
		})
	}
}

// @scenario "A relative link is resolved against the repository, not the network"
func TestRunResolvesARelativeLinkAgainstTheRepository(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "LICENSE.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	fetched := false
	checker := linkcheck.Checker{
		RepoRoot: root,
		Fetch: func(context.Context, string) (int, error) {
			fetched = true
			return http.StatusNotFound, nil
		},
	}

	results := checker.Run(t.Context(), filepath.Join(root, "README.md"), "[license](/LICENSE.md)")

	if fetched {
		t.Error("a repository path was fetched over the network")
	}
	if got := verdictOf(t, results, "/LICENSE.md").Verdict; got != linkcheck.OK {
		t.Errorf("got %v, want OK", got)
	}
}

// @scenario "A relative link to a path that no longer exists fails the check"
func TestRunFailsOnARelativeLinkToAnAbsentPath(t *testing.T) {
	checker := linkcheck.Checker{RepoRoot: t.TempDir()}
	document := "[gone](/platform/app/ee/LICENSE.md)"

	results := checker.Run(t.Context(), "README.md", document)

	missing := verdictOf(t, results, "/platform/app/ee/LICENSE.md")
	if missing.Verdict != linkcheck.Dead {
		t.Errorf("got %v, want Dead", missing.Verdict)
	}
	if !strings.Contains(missing.Detail, "platform/app/ee/LICENSE.md") {
		t.Errorf("want the offending path reported, got %q", missing.Detail)
	}
}

// The fetcher is exercised against a real server; Run's grading is exercised
// with a stub, because a loopback test server is exactly what Classify
// declines to fetch.
//
// @scenario "A redirect to a live page passes"
func TestHTTPFetcherFollowsRedirectsToALivePage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/moved" {
			http.Redirect(writer, request, "/live", http.StatusMovedPermanently)
			return
		}
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	status, err := linkcheck.HTTPFetcher(5*time.Second)(t.Context(), server.URL+"/moved")

	if err != nil {
		t.Fatalf("got error %v, want none", err)
	}
	if status != http.StatusOK {
		t.Errorf("got status %d, want 200", status)
	}
	if got := linkcheck.VerdictFor(status, err); got != linkcheck.OK {
		t.Errorf("got %v, want OK", got)
	}
}

func TestHTTPFetcherReportsTheStatusOfADeadPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	status, err := linkcheck.HTTPFetcher(5*time.Second)(t.Context(), server.URL+"/x")

	if err != nil {
		t.Fatalf("got error %v, want none", err)
	}
	if status != http.StatusNotFound {
		t.Errorf("got status %d, want 404", status)
	}
}

// @scenario "A link that times out does not fail the check"
func TestHTTPFetcherSurvivesAHostThatNeverAnswers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	// Accepted and then left hanging: the request times out rather than being
	// refused, which is the case that must not read as a dead link.
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			defer connection.Close()
			<-t.Context().Done()
		}
	}()

	status, err := linkcheck.HTTPFetcher(200*time.Millisecond)(t.Context(), "http://"+listener.Addr().String())

	if err == nil {
		t.Fatalf("got status %d and no error, want a transport error", status)
	}
	if got := linkcheck.VerdictFor(status, err); got != linkcheck.Unverified {
		t.Errorf("got %v, want Unverified", got)
	}
}

// answering is a Fetch stub that gives every URL the same status.
func answering(status int) linkcheck.Fetcher {
	return func(context.Context, string) (int, error) { return status, nil }
}

// @scenario "A markdown link to a page that is gone fails the check"
func TestRunReportsADeadPageWithItsStatus(t *testing.T) {
	checker := linkcheck.Checker{RepoRoot: t.TempDir(), Fetch: answering(http.StatusNotFound)}

	results := checker.Run(t.Context(), "README.md", "[gone](https://docs.langwatch.ai/self-hosting/hybrid)")

	result := verdictOf(t, results, "https://docs.langwatch.ai/self-hosting/hybrid")
	if result.Verdict != linkcheck.Dead {
		t.Errorf("got %v, want Dead", result.Verdict)
	}
	if result.Status != http.StatusNotFound {
		t.Errorf("got status %d, want 404", result.Status)
	}
}

// @scenario "A link to a page that has been removed for good fails the check"
func TestRunTreatsAGoneStatusAsDead(t *testing.T) {
	checker := linkcheck.Checker{RepoRoot: t.TempDir(), Fetch: answering(http.StatusGone)}

	results := checker.Run(t.Context(), "README.md", "[removed](https://langwatch.ai/removed)")

	if got := verdictOf(t, results, "https://langwatch.ai/removed").Verdict; got != linkcheck.Dead {
		t.Errorf("got %v, want Dead", got)
	}
}

// npmjs.com answers 403 to CI egress addresses. The package page is fine; the
// checker is simply not a browser.
//
// @scenario "A bot-blocked host does not fail the check"
func TestRunTreatsABotBlockAsUnverified(t *testing.T) {
	checker := linkcheck.Checker{RepoRoot: t.TempDir(), Fetch: answering(http.StatusForbidden)}

	results := checker.Run(t.Context(), "README.md", "[npm](https://www.npmjs.com/package/langwatch)")

	if got := verdictOf(t, results, "https://www.npmjs.com/package/langwatch").Verdict; got != linkcheck.Unverified {
		t.Errorf("got %v, want Unverified", got)
	}
}

// @scenario "Each distinct target is fetched once"
func TestRunFetchesEachDistinctTargetOnce(t *testing.T) {
	var requests int
	checker := linkcheck.Checker{
		RepoRoot: t.TempDir(),
		Fetch: func(context.Context, string) (int, error) {
			requests++
			return http.StatusOK, nil
		},
	}

	document := "[a](https://langwatch.ai) [b](https://langwatch.ai) [c](https://langwatch.ai)"
	results := checker.Run(t.Context(), "README.md", document)

	if requests != 1 {
		t.Errorf("got %d requests, want 1", requests)
	}
	if len(results) != 1 {
		t.Errorf("got %d results, want 1: %v", len(results), targets(results))
	}
}

// @scenario "Anchors, mailto and localhost are not fetched"
func TestRunDoesNotFetchIgnoredTargets(t *testing.T) {
	fetched := false
	checker := linkcheck.Checker{
		RepoRoot: t.TempDir(),
		Fetch: func(context.Context, string) (int, error) {
			fetched = true
			return http.StatusOK, nil
		},
	}

	document := "[a](#section) [b](mailto:security@langwatch.ai) [c](http://localhost:5560)"
	results := checker.Run(t.Context(), "README.md", document)

	if fetched {
		t.Error("an ignored target was fetched")
	}
	if len(results) != 0 {
		t.Errorf("got %v, want no results", targets(results))
	}
}

func TestRunSkipsURLsWhenOffline(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "NOTICE"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	checker := linkcheck.Checker{RepoRoot: root}
	results := checker.Run(t.Context(), filepath.Join(root, "README.md"), "[n](/NOTICE) [d](https://docs.langwatch.ai)")

	if len(results) != 1 || results[0].Target != "/NOTICE" {
		t.Errorf("got %v, want only the repository path", targets(results))
	}
}
