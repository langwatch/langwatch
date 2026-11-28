package disposabledomains

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	repository = "disposable-email-domains/disposable-email-domains"
	listFile   = "disposable_email_blocklist.conf"
	rulesDir   = "modules/organization/process/src/rules"
	listOut    = "disposable-email-domains.generated.json"
	sourceOut  = "disposable-email-domains.source.json"
)

var commitShape = regexp.MustCompile(`^[0-9a-f]{40}$`)

// Upstream is where the list is read from; tests point it at a local server.
type Upstream struct {
	API    string
	Raw    string
	Client *http.Client
}

// GitHub is the real upstream.
var GitHub = Upstream{
	API:    "https://api.github.com",
	Raw:    "https://raw.githubusercontent.com",
	Client: &http.Client{Timeout: 60 * time.Second},
}

// Run refreshes the list from GitHub. It returns the process exit code: 0 when
// both files are written, 2 when the list could not be read or failed a guard.
func Run(args []string, stdout, stderr io.Writer) int {
	return GitHub.Run(args, stdout, stderr)
}

// Run is the CLI against this upstream.
func (upstream Upstream) Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("disposabledomains", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", ".", "repository root")
	commit := flags.String("commit", "", "upstream commit to read; empty reads what main points at")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	source, err := refresh(upstream, *root, *commit)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	fmt.Fprintf(stdout, "Wrote %d domains from %s@%s\n", source.Domains, source.Repository, source.Commit)
	return 0
}

func refresh(upstream Upstream, root, commit string) (Source, error) {
	if commit == "" {
		resolved, err := upstream.mainCommit()
		if err != nil {
			return Source{}, err
		}
		commit = resolved
	}
	if !commitShape.MatchString(commit) {
		return Source{}, fmt.Errorf("not a full commit sha: %q", commit)
	}
	text, err := upstream.get(fmt.Sprintf("%s/%s/%s/%s", upstream.Raw, repository, commit, listFile), "")
	if err != nil {
		return Source{}, err
	}
	domains, err := ParseList(text, MinimumDomains)
	if err != nil {
		return Source{}, err
	}
	source := Source{Repository: repository, File: listFile, Commit: commit, Domains: len(domains)}
	if err := writeJSON(filepath.Join(root, rulesDir, listOut), domains); err != nil {
		return Source{}, err
	}
	return source, writeJSON(filepath.Join(root, rulesDir, sourceOut), source)
}

func (upstream Upstream) mainCommit() (string, error) {
	body, err := upstream.get(fmt.Sprintf("%s/repos/%s/commits/main", upstream.API, repository), "application/vnd.github.sha")
	return strings.TrimSpace(body), err
}

func (upstream Upstream) get(url, accept string) (string, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	response, err := upstream.Client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("fetching %s answered %d", url, response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	return string(body), err
}

func writeJSON(path string, value any) error {
	rendered, err := RenderJSON(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, rendered, 0o600)
}
