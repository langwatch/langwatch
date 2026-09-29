package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/sync/errgroup"
)

// PublishDir is where a run stages the images and body its PR comment posts.
const PublishDir = "publish"

// PublishRequest is one run's publish: its rows, its refs and where it ran.
type PublishRequest struct {
	Run          runner
	Root         string
	RunDir       string
	BaseRef      string
	CandidateRef string
	Rows         []Row
	Findings     int
	Config       PublishConfig
	Stderr       io.Writer
	// PR is the pull request to publish to; empty publishes to the open one
	// of the branch checked out at Root. Link is where the run's full report
	// lives, shown under the headline.
	PR   string
	Link string
}

// Publish shows a run's selected screens on the pull request of the branch
// checked out at Root, editing the one comment marked PublishMarker in place.
// It returns the comment's address, or "" when it skipped, having said why.
func Publish(ctx context.Context, request PublishRequest) (string, error) {
	gh := ghClient{run: request.Run, root: request.Root}
	pr, skip := gh.pullRequest(ctx, request.PR)
	if skip != "" {
		fmt.Fprintf(request.Stderr, "publish: skipped, %s\n", skip)
		return "", nil
	}
	if err := gh.publishStatus(ctx, request, pr); err != nil {
		fmt.Fprintln(request.Stderr, err)
	}
	picks := SelectScreens(request.Rows, request.Config)
	if len(picks) == 0 {
		fmt.Fprintln(request.Stderr, "publish: skipped, no screen passed the selection and the secret guard")
		return "", nil
	}
	dir := filepath.Join(request.RunDir, PublishDir)
	images, err := request.stage(ctx, picks)
	if err != nil {
		return "", err
	}
	url, err := gh.upsertComment(ctx, stagedComment{pr: pr, dir: dir, images: images})
	if err != nil {
		return "", err
	}
	fmt.Fprintf(request.Stderr, "publish: %d screens on PR #%s: %s\n", len(picks), pr, url)
	return url, nil
}

// stage scales each picked screen into the run's publish directory and
// writes the body beside them.
func (request PublishRequest) stage(ctx context.Context, picks []ScreenPick) ([]PublishedImage, error) {
	dir := filepath.Join(request.RunDir, PublishDir)
	_ = os.RemoveAll(dir)
	headline := headlineFor(request.Rows, request.Findings)
	headline.RunID, headline.Link = filepath.Base(request.RunDir), request.Link
	headline.BaseCommit, _ = resolveCommit(ctx, gitRef{run: request.Run, root: request.Root, ref: request.BaseRef})
	headline.CandidateCommit, _ = resolveCommit(ctx, gitRef{run: request.Run, root: request.Root, ref: request.CandidateRef})
	body, images := RenderComment(headline, picks)
	if err := shrinkPicks(picks, dir, request.Config.filled()); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "body.md"), []byte(body), 0o600); err != nil {
		return nil, err
	}
	return images, nil
}

// shrinkPicks scales every picked screen into dir, all at once: each is one
// file in and one file out, and one at a time they cost a run twenty seconds.
func shrinkPicks(picks []ScreenPick, dir string, config PublishConfig) error {
	var shrinks errgroup.Group
	for index := range picks {
		pick := &picks[index]
		sides := map[string]string{"candidate": pick.Row.Candidate.Screenshot}
		if pick.Paired {
			sides["base"] = pick.Row.Base.Screenshot
		}
		for side, source := range sides {
			target := filepath.Join(dir, fmt.Sprintf("%02d-%s.png", index, side))
			shrinks.Go(func() error {
				if err := shrinkImage(source, target, config); err != nil {
					return fmt.Errorf("publish: scale %s: %w", pick.Row.Key, err)
				}
				return nil
			})
		}
	}
	return shrinks.Wait()
}

// ghClient runs gh from the repository root, where `{owner}/{repo}` resolves.
type ghClient struct {
	run  runner
	root string
}

func (gh ghClient) output(ctx context.Context, spec commandSpec) (string, error) {
	var out bytes.Buffer
	if spec.dir == "" {
		spec.dir = gh.root
	}
	err := gh.run(ctx, spec, &out)
	return strings.TrimSpace(out.String()), err
}

// pullRequest is the named PR, else the open PR of the branch at root, or
// why there is none to publish to.
func (gh ghClient) pullRequest(ctx context.Context, named string) (string, string) {
	if _, err := gh.output(ctx, commandSpec{name: "gh", args: []string{"auth", "status"}}); err != nil {
		return "", "gh is not signed in"
	}
	if named != "" {
		return named, ""
	}
	branch, err := gh.output(ctx, commandSpec{name: "git", args: []string{"rev-parse", "--abbrev-ref", "HEAD"}})
	if err != nil || branch == "" || branch == "HEAD" {
		return "", "the checkout is on no branch"
	}
	number, err := gh.output(ctx, commandSpec{name: "gh", args: []string{"pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", ".[0].number"}})
	if err != nil || number == "" || number == "null" {
		return "", "no open pull request for " + branch
	}
	return number, ""
}

// stagedComment is a comment ready to post: its PR, the directory holding its
// body and images, and the images its body references.
type stagedComment struct {
	pr     string
	dir    string
	images []PublishedImage
}

// upsertComment posts the staged comment, then, when the PR already carries
// the marked comment, moves the posted body into it and deletes the post:
// gh uploads attachments only by posting, and the PR keeps one comment.
func (gh ghClient) upsertComment(ctx context.Context, comment stagedComment) (string, error) {
	marker, err := gh.markerComment(ctx, comment.pr)
	if err != nil {
		return "", err
	}
	args := []string{"pr", "comment", comment.pr, "--body-file", "body.md"}
	for _, image := range comment.images {
		args = append(args, "--attach", image.Path+"#"+image.Alt)
	}
	posted, err := gh.output(ctx, commandSpec{name: "gh", args: args, dir: comment.dir})
	if err != nil {
		return "", fmt.Errorf("publish: gh pr comment: %w", err)
	}
	match := commentID.FindStringSubmatch(posted)
	if match == nil {
		return "", fmt.Errorf("publish: gh pr comment answered no comment address: %q", posted)
	}
	if marker == "" || marker == match[1] {
		return posted, nil
	}
	return gh.moveComment(ctx, commentMove{posted: match[1], marker: marker, dir: comment.dir})
}

// commentMove is a posted comment whose body replaces the marked one's.
type commentMove struct {
	posted string
	marker string
	dir    string
}

var commentID = regexp.MustCompile(`#issuecomment-(\d+)`)

// markerComment is the id of the PR's comment carrying PublishMarker, the
// newest when there are several, or "".
func (gh ghClient) markerComment(ctx context.Context, pr string) (string, error) {
	ids, err := gh.output(ctx, commandSpec{name: "gh", args: []string{
		"api", "--paginate", "repos/{owner}/{repo}/issues/" + pr + "/comments",
		"--jq", `.[] | select(.body | contains("` + PublishMarker + `")) | .id`,
	}})
	if err != nil {
		return "", fmt.Errorf("publish: read the PR's comments: %w", err)
	}
	lines := strings.Fields(ids)
	if len(lines) == 0 {
		return "", nil
	}
	return lines[len(lines)-1], nil
}

// moveComment copies the posted comment's body, its attachments already
// rewritten to uploaded assets, over the marked comment, then deletes the post.
func (gh ghClient) moveComment(ctx context.Context, move commentMove) (string, error) {
	posted, marker := move.posted, move.marker
	body, err := gh.output(ctx, commandSpec{name: "gh", args: []string{"api", "repos/{owner}/{repo}/issues/comments/" + posted, "--jq", ".body"}})
	if err != nil {
		return "", fmt.Errorf("publish: read the posted comment: %w", err)
	}
	encoded, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return "", err
	}
	patch := filepath.Join(move.dir, "patch.json")
	if err := os.WriteFile(patch, encoded, 0o600); err != nil {
		return "", err
	}
	url, err := gh.output(ctx, commandSpec{name: "gh", args: []string{
		"api", "-X", "PATCH", "repos/{owner}/{repo}/issues/comments/" + marker, "--input", patch, "--jq", ".html_url",
	}})
	if err != nil {
		return "", fmt.Errorf("publish: update the marked comment %s: %w", marker, err)
	}
	if _, err := gh.output(ctx, commandSpec{name: "gh", args: []string{"api", "-X", "DELETE", "repos/{owner}/{repo}/issues/comments/" + posted}}); err != nil {
		return url, fmt.Errorf("publish: delete the staging comment %s: %w", posted, err)
	}
	return url, nil
}
