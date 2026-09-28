package visualdiff

import (
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// PublishMarker is the hidden token that names the one comment a PR carries
// for visualdiff's screens: each run edits it in place.
const PublishMarker = "<!-- visualdiff:screens -->"

// PublishConfig is visualdiff.yaml's `publish`: how many screens a PR comment
// shows, how wide each image is scaled to and how tall it is cut at, and the
// key pages that fill what the changes and failures leave.
type PublishConfig struct {
	Screens   int      `yaml:"screens"`
	Width     int      `yaml:"width"`
	MaxHeight int      `yaml:"maxHeight"`
	KeyPages  []string `yaml:"keyPages"`
}

// filled defaults an absent or zero setting.
func (config PublishConfig) filled() PublishConfig {
	if config.Screens <= 0 {
		config.Screens = 12
	}
	if config.Width <= 0 {
		config.Width = 1000
	}
	if config.MaxHeight <= 0 {
		config.MaxHeight = 2000
	}
	return config
}

// ScreenPick is one screen a PR comment shows: the candidate's capture, and
// the base's beside it when the base is readable.
type ScreenPick struct {
	Row    Row
	Reason string
	Paired bool
}

// failureClasses are the candidate-side failures a comment shows after the
// largest changes: each has a candidate screenshot to show.
var failureClasses = map[Classification]bool{
	ClassRegression: true, ClassNotFound: true, ClassBlank: true, ClassAPIError: true,
	ClassRedirect: true, ClassControls: true,
}

// SelectScreens picks what a PR comment shows, in order: the changed routes
// with the largest diff, then the candidate's failures, then the key pages,
// never a screen the secret guard refuses, and at most config.Screens.
func SelectScreens(rows []Row, config PublishConfig) []ScreenPick {
	config = config.filled()
	picker := screenPicker{limit: config.Screens, seen: map[string]bool{}}
	picker.take(changedRoutes(rows), "changed")
	picker.take(failedScreens(rows), "failure")
	picker.take(keyPages(rows, config.KeyPages), "key page")
	return picker.picks
}

type screenPicker struct {
	limit int
	seen  map[string]bool
	picks []ScreenPick
}

func (picker *screenPicker) take(rows []Row, reason string) {
	for index := range rows {
		row := rows[index]
		identity := fmt.Sprintf("%s|%s|%s|%d", row.Edition, row.Kind, row.Key, row.Index)
		if len(picker.picks) >= picker.limit || picker.seen[identity] || !publishable(row) {
			continue
		}
		picker.seen[identity] = true
		picker.picks = append(picker.picks, ScreenPick{Row: row, Reason: reason, Paired: baseReadable(row)})
	}
}

// changedRoutes are the routes whose pixels moved past noise, largest first.
func changedRoutes(rows []Row) []Row {
	var changed []Row
	for index := range rows {
		row := &rows[index]
		if row.Kind == "route" && row.Diffed && row.Ratio >= NoiseRatio && !failureClasses[row.Class] {
			changed = append(changed, *row)
		}
	}
	sort.SliceStable(changed, func(i, j int) bool { return changed[i].Ratio > changed[j].Ratio })
	return changed
}

// failedScreens are the candidate's failures, the worst class first.
func failedScreens(rows []Row) []Row {
	var failed []Row
	for index := range rows {
		if failureClasses[rows[index].Class] {
			failed = append(failed, rows[index])
		}
	}
	sort.SliceStable(failed, func(i, j int) bool { return classRank(failed[i].Class) < classRank(failed[j].Class) })
	return failed
}

// keyPages are the configured pages, in the order configured.
func keyPages(rows []Row, pages []string) []Row {
	var found []Row
	for _, page := range pages {
		for index := range rows {
			if rows[index].Kind == "route" && rows[index].Key == page {
				found = append(found, rows[index])
			}
		}
	}
	return found
}

// baseReadable reports a base capture worth showing beside the candidate: it
// rendered, and main's passkey offer is not covering it.
func baseReadable(row Row) bool {
	base := row.Base
	if base == nil || base.Screenshot == "" || base.Error != "" || base.Blank {
		return false
	}
	return !strings.Contains(base.AriaSnapshot, "Sign in faster next time")
}

// secretPatterns are what a public comment must never carry: keys and tokens
// in any common shape, and a local file path an error detail printed.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}`),
	regexp.MustCompile(`\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}`),
	regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
	regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`),
	regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`),
	regexp.MustCompile(`(?i)\b(?:api[_-]?key|secret|token|password|bearer)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}`),
	regexp.MustCompile(`(?:^|[\s"'(])/(?:Users|home)/[^\s"')]+`),
}

// publishable reports a screen the secret guard lets through: a candidate
// screenshot exists, and neither its address nor its text on either side
// looks like a key, a token or a local path.
func publishable(row Row) bool {
	if row.Candidate == nil || row.Candidate.Screenshot == "" {
		return false
	}
	for _, capture := range []*Capture{row.Candidate, row.Base} {
		if capture != nil && looksSecret(captureText(capture)) {
			return false
		}
	}
	return !looksSecret(row.Key)
}

func captureText(capture *Capture) string {
	parts := append([]string{capture.URL, capture.AriaSnapshot, capture.Error}, capture.ConsoleErrors...)
	return strings.Join(append(parts, capture.FailedRequests...), "\n")
}

func looksSecret(text string) bool {
	for _, pattern := range secretPatterns {
		if pattern.MatchString(text) {
			return true
		}
	}
	return false
}

// PublishHeadline is what the comment says above its gallery.
type PublishHeadline struct {
	RunID           string
	BaseCommit      string
	CandidateCommit string
	Rows            int
	Findings        int
	Classes         map[Classification]int
}

// headlineFor counts a run's rows by class for the comment.
func headlineFor(rows []Row, findings int) PublishHeadline {
	classes := map[Classification]int{}
	for index := range rows {
		classes[rows[index].Class]++
	}
	return PublishHeadline{Rows: len(rows), Findings: findings, Classes: classes}
}

// PublishedImage is one image file the comment attaches, by the relative
// path its body references.
type PublishedImage struct {
	Path string
	Alt  string
}

// RenderComment writes the comment body: the marker, the run, the counts and
// a gallery whose image references gh rewrites to the uploaded assets.
func RenderComment(headline PublishHeadline, picks []ScreenPick) (string, []PublishedImage) {
	var body strings.Builder
	body.WriteString(PublishMarker + "\n")
	fmt.Fprintf(&body, "### visualdiff: %d screens, %d findings\n\n", headline.Rows, headline.Findings)
	fmt.Fprintf(&body, "Run `%s` · base `%s` · candidate `%s`\n\n", headline.RunID, short(headline.BaseCommit), short(headline.CandidateCommit))
	body.WriteString(classLine(headline.Classes) + "\n")
	var images []PublishedImage
	for index := range picks {
		pick := &picks[index]
		candidate := PublishedImage{Path: fmt.Sprintf("./%02d-candidate.png", index), Alt: "candidate " + screenTitle(pick.Row)}
		fmt.Fprintf(&body, "\n#### %d. %s (%s)\n%s\n\n", index+1, screenTitle(pick.Row), pick.Reason, pickWhy(pick.Row))
		images = append(images, candidate)
		if !pick.Paired {
			fmt.Fprintf(&body, "![%s](%s)\n", candidate.Alt, candidate.Path)
			continue
		}
		base := PublishedImage{Path: fmt.Sprintf("./%02d-base.png", index), Alt: "base " + screenTitle(pick.Row)}
		images = append(images, base)
		fmt.Fprintf(&body, "| candidate | base |\n| --- | --- |\n| ![%s](%s) | ![%s](%s) |\n", candidate.Alt, candidate.Path, base.Alt, base.Path)
	}
	return body.String(), images
}

func screenTitle(row Row) string {
	title := row.Key
	if row.Kind == "flow" {
		title = fmt.Sprintf("%s · %s", row.Key, row.Label)
	}
	if row.Edition != "" {
		title = fmt.Sprintf("[%s] %s", row.Edition, title)
	}
	return strings.ReplaceAll(strings.ReplaceAll(title, "[", "("), "]", ")")
}

func pickWhy(row Row) string {
	why := fmt.Sprintf("`%s`", row.Class)
	if row.Why != "" {
		why += ": " + markdownCell(head(row.Why))
	}
	return why
}

func classLine(classes map[Classification]int) string {
	var parts []string
	for _, class := range classOrder {
		if classes[class] > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", class, classes[class]))
		}
	}
	return strings.Join(parts, " · ")
}

func short(commit string) string {
	if len(commit) > 12 {
		return commit[:12]
	}
	return commit
}

// shrinkImage writes source scaled to width (never up) and cut at maxHeight,
// so a comment's images keep the assets small.
func shrinkImage(source, target string, config PublishConfig) error {
	input, err := os.Open(source) // #nosec G304 -- a screenshot this run's own runner wrote.
	if err != nil {
		return err
	}
	decoded, err := png.Decode(input)
	_ = input.Close()
	if err != nil {
		return err
	}
	scaled := scaleDown(decoded, config.Width, config.MaxHeight)
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	output, err := os.Create(target) // #nosec G304 -- inside the run's own publish directory.
	if err != nil {
		return err
	}
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(output, scaled); err != nil {
		_ = output.Close()
		return err
	}
	return output.Close()
}

// scaleDown averages each target pixel over its source block.
func scaleDown(decoded image.Image, width, maxHeight int) image.Image {
	source := image.NewRGBA(image.Rect(0, 0, decoded.Bounds().Dx(), decoded.Bounds().Dy()))
	draw.Draw(source, source.Bounds(), decoded, decoded.Bounds().Min, draw.Src)
	scale := 1.0
	if source.Rect.Dx() > width {
		scale = float64(width) / float64(source.Rect.Dx())
	}
	targetWidth := int(float64(source.Rect.Dx()) * scale)
	targetHeight := min(int(float64(source.Rect.Dy())*scale), maxHeight)
	target := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	for y := range targetHeight {
		for x := range targetWidth {
			block := image.Rect(int(float64(x)/scale), int(float64(y)/scale), int(float64(x+1)/scale), int(float64(y+1)/scale))
			copy(target.Pix[target.PixOffset(x, y):], blockAverage(source, block))
		}
	}
	return target
}

// blockAverage is the mean RGBA of a block of source, white when it is empty.
func blockAverage(source *image.RGBA, block image.Rectangle) []uint8 {
	block = block.Intersect(source.Rect)
	if block.Empty() {
		return []uint8{255, 255, 255, 255}
	}
	var sums [4]int
	for y := block.Min.Y; y < block.Max.Y; y++ {
		row := source.Pix[source.PixOffset(block.Min.X, y):source.PixOffset(block.Max.X, y)]
		for index, value := range row {
			sums[index%4] += int(value)
		}
	}
	count := block.Dx() * block.Dy()
	return []uint8{uint8(sums[0] / count), uint8(sums[1] / count), uint8(sums[2] / count), uint8(sums[3] / count)} // #nosec G115 -- a mean of 8-bit channels fits 8 bits.
}
