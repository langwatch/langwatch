package visualdiff

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func screen(key string, class Classification, ratio float64) Row {
	return Row{
		Kind: "route", Key: key, Class: class, Ratio: ratio, Diffed: true,
		Base:      &Capture{Screenshot: "/shots/base" + key + ".png"},
		Candidate: &Capture{Screenshot: "/shots/candidate" + key + ".png"},
	}
}

func pickedKeys(picks []ScreenPick) []string {
	var out []string
	for index := range picks {
		out = append(out, picks[index].Row.Key)
	}
	return out
}

// @scenario "A run's screens are chosen by what changed most, then what broke, then the key pages"
func TestScreensAreChosenByChangeThenFailureThenKeyPage(t *testing.T) {
	rows := []Row{
		screen("/{slug}", ClassNoise, 0.001),
		screen("/{slug}/small", ClassChanged, 0.03),
		screen("/{slug}/large", ClassChanged, 0.4),
		screen("/{slug}/broken", ClassRegression, 0.5),
		screen("/settings", ClassNoise, 0),
		screen("/{slug}/blank", ClassBlank, 0.9),
	}
	config := PublishConfig{Screens: 5, KeyPages: []string{"/{slug}", "/settings", "/governance"}}

	picks := SelectScreens(rows, config)

	want := []string{"/{slug}/large", "/{slug}/small", "/{slug}/broken", "/{slug}/blank", "/{slug}"}
	if strings.Join(pickedKeys(picks), ",") != strings.Join(want, ",") {
		t.Fatalf("picked %v, want %v", pickedKeys(picks), want)
	}
	if picks[0].Reason != "changed" || picks[2].Reason != "failure" || picks[4].Reason != "key page" {
		t.Errorf("reasons: %+v", picks)
	}
}

// @scenario "A screen that could leak a secret or a local path is never published"
func TestAScreenThatCouldLeakIsNeverPublished(t *testing.T) {
	leaks := []Row{
		screen("/{slug}/a", ClassChanged, 0.5),
		screen("/{slug}/b", ClassChanged, 0.5),
		screen("/{slug}/c", ClassChanged, 0.5),
	}
	leaks[0].Candidate.AriaSnapshot = `- textbox "API key": sk-lw-0123456789abcdefghij`
	leaks[1].Base.ConsoleErrors = []string{"Error: useLangy at /Users/dev/langwatch/modules/langy/src/x.ts:12"}
	leaks[2].Candidate.AriaSnapshot = `- text: "token: ghp_abcdefghijklmnopqrstuvwxyz0123"`
	clean := screen("/{slug}/d", ClassChanged, 0.1)

	picks := SelectScreens(append(leaks, clean), PublishConfig{})

	if strings.Join(pickedKeys(picks), ",") != "/{slug}/d" {
		t.Fatalf("published %v, want only the clean screen", pickedKeys(picks))
	}
}

// @scenario "The PR comment carries the run, its counts and a gallery gh uploads"
func TestThePRCommentCarriesTheRunItsCountsAndAGallery(t *testing.T) {
	readable := screen("/{slug}/traces", ClassChanged, 0.2)
	covered := screen("/{slug}/home", ClassChanged, 0.1)
	covered.Base.AriaSnapshot = `- heading "Sign in faster next time"`
	picks := SelectScreens([]Row{readable, covered}, PublishConfig{})

	body, images := RenderComment(PublishHeadline{
		RunID: "20260928-100429", BaseCommit: testBaseCommit, CandidateCommit: "fedcba9876543210",
		Rows: 215, Findings: 3, Classes: map[Classification]int{ClassChanged: 2, ClassRegression: 1},
	}, picks)

	for _, want := range []string{PublishMarker, "215 screens, 3 findings", "`20260928-100429`", "`0123456789ab`", "regression 1", "changed 2", "![candidate /{slug}/traces](./00-candidate.png)", "![base /{slug}/traces](./00-base.png)", "![candidate /{slug}/home](./01-candidate.png)"} {
		if !strings.Contains(body, want) {
			t.Errorf("body lacks %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "01-base.png") || len(images) != 3 {
		t.Errorf("a base behind the passkey offer is shown: %v", images)
	}
}

// fakeGH answers the git and gh commands a publish makes.
type fakeGH struct {
	mutex    sync.Mutex
	commands []string
	marker   string
}

func (fake *fakeGH) run(_ context.Context, spec commandSpec, log io.Writer) error {
	line := spec.name + " " + strings.Join(spec.args, " ")
	fake.mutex.Lock()
	fake.commands = append(fake.commands, line)
	fake.mutex.Unlock()
	answers := map[string]string{
		"git rev-parse --abbrev-ref": "feat/strict-feature-layout-v0",
		"git rev-parse --verify":     testBaseCommit,
		"gh pr list":                 "7536",
		"gh api --paginate":          fake.marker,
		"gh pr comment":              "https://github.com/langwatch/langwatch/pull/7536#issuecomment-900",
		"gh api repos/{owner}/{repo}/issues/comments/900 --jq .body": "![shot](https://github.com/user-attachments/assets/x)",
		"gh api -X PATCH": "https://github.com/langwatch/langwatch/pull/7536#issuecomment-" + fake.marker,
	}
	for prefix, answer := range answers {
		if strings.HasPrefix(line, prefix) {
			_, err := io.WriteString(log, answer+"\n")
			return err
		}
	}
	return nil
}

func publishRequest(t *testing.T, fake *fakeGH) PublishRequest {
	t.Helper()
	dir := t.TempDir()
	shot := filepath.Join(dir, "shot.png")
	picture := image.NewRGBA(image.Rect(0, 0, 1200, 2600))
	for y := range 2600 {
		for x := range 1200 {
			picture.Set(x, y, color.RGBA{R: uint8(x % 256), A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shot, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	row := screen("/{slug}/traces", ClassChanged, 0.2)
	row.Base.Screenshot, row.Candidate.Screenshot = shot, shot
	return PublishRequest{
		Run: fake.run, Root: dir, RunDir: filepath.Join(dir, "run"), BaseRef: "origin/main", CandidateRef: "HEAD",
		Rows: []Row{row}, Findings: 1, Stderr: io.Discard,
	}
}

// @scenario "Each run edits the PR's one marked comment in place"
func TestEachRunEditsThePRsOneMarkedCommentInPlace(t *testing.T) {
	t.Run("given a PR with no marked comment, the posted comment becomes it", func(t *testing.T) {
		fake := &fakeGH{}
		url, err := Publish(context.Background(), publishRequest(t, fake))
		if err != nil || !strings.HasSuffix(url, "#issuecomment-900") {
			t.Fatalf("url %q err %v", url, err)
		}
		for _, line := range fake.commands {
			if strings.Contains(line, "PATCH") || strings.Contains(line, "DELETE") {
				t.Errorf("a first publish moved a comment: %s", line)
			}
		}
	})

	t.Run("given a PR with a marked comment, its body is replaced and the staging post deleted", func(t *testing.T) {
		fake := &fakeGH{marker: "5869457132"}
		request := publishRequest(t, fake)
		url, err := Publish(context.Background(), request)
		if err != nil || !strings.HasSuffix(url, "#issuecomment-5869457132") {
			t.Fatalf("url %q err %v", url, err)
		}
		joined := strings.Join(fake.commands, "\n")
		for _, want := range []string{
			"gh pr comment 7536 --body-file body.md --attach ./00-candidate.png#candidate /{slug}/traces --attach ./00-base.png#base /{slug}/traces",
			"gh api -X PATCH repos/{owner}/{repo}/issues/comments/5869457132",
			"gh api -X DELETE repos/{owner}/{repo}/issues/comments/900",
		} {
			if !strings.Contains(joined, want) {
				t.Errorf("publish never ran %q:\n%s", want, joined)
			}
		}
		patch, err := os.ReadFile(filepath.Join(request.RunDir, PublishDir, "patch.json"))
		if err != nil || !strings.Contains(string(patch), "user-attachments") {
			t.Errorf("the marked comment was not given the uploaded body: %s (%v)", patch, err)
		}
		shrunk, err := os.Open(filepath.Join(request.RunDir, PublishDir, "00-candidate.png"))
		if err != nil {
			t.Fatal(err)
		}
		defer shrunk.Close()
		config, err := png.DecodeConfig(shrunk)
		if err != nil || config.Width != 1000 || config.Height != 2000 {
			t.Errorf("the image was not scaled to 1000 wide and cut at 2000: %+v (%v)", config, err)
		}
	})

	t.Run("given no open PR, it skips and posts nothing", func(t *testing.T) {
		fake := &fakeGH{}
		request := publishRequest(t, fake)
		request.Run = func(ctx context.Context, spec commandSpec, log io.Writer) error {
			if spec.name == "gh" && len(spec.args) > 1 && spec.args[1] == "list" {
				return nil
			}
			return fake.run(ctx, spec, log)
		}
		var stderr bytes.Buffer
		request.Stderr = &stderr
		if url, err := Publish(context.Background(), request); url != "" || err != nil {
			t.Fatalf("url %q err %v", url, err)
		}
		if !strings.Contains(stderr.String(), "publish: skipped, no open pull request") {
			t.Errorf("stderr: %s", stderr.String())
		}
	})
}
