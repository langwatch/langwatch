package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// The two workflows that publish to the artifacts registry. See
// specs/ci/publish-prerelease-charts-to-ecr.feature and
// specs/ci/publish-ecr-images.feature.
const (
	ChartsWorkflow = ".github/workflows/prerelease-charts-oci.yml"
	ImagesWorkflow = ".github/workflows/publish-docker-ecr.yml"
)

var (
	// A push that bypasses cmd/chartpush, which pushes only to -registry.
	directPush = regexp.MustCompile(`(?i)\b(?:helm|oras|docker|crane)\s+push\b|oci://`)
	// The only registry chartpush may be handed: the account's private ECR.
	registryAssign  = regexp.MustCompile(`^\s*registry=(.*)$`)
	privateECRHost  = `"${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"`
	chartpushTarget = regexp.MustCompile(`-registry\s+(\S+)`)
	packagesWrite   = regexp.MustCompile(`packages:\s*write`)
	signing         = regexp.MustCompile(`(?i)cosign|sigstore`)
	ecrCharts       = regexp.MustCompile(`^\s*ECR_CHARTS:\s*(.*)$`)
	mainOnly        = "github.ref == 'refs/heads/main'"
)

// PublishShape reports every way the publish workflows could reach a public
// registry, sign the private copy, publish from a release, or leave a chart
// unpushed.
func PublishShape(repoRoot string) ([]string, error) {
	charts, err := codeLines(repoRoot, ChartsWorkflow)
	if err != nil {
		return nil, err
	}
	meta, err := ciscan.Load(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}
	onDisk, err := chartsOnDisk(repoRoot)
	if err != nil {
		return nil, err
	}
	release, err := hasReleaseTrigger(repoRoot, ImagesWorkflow)
	if err != nil {
		return nil, err
	}

	problems := chartDestinations(charts)
	problems = append(problems, chartSigning(charts)...)
	problems = append(problems, imagesOnlyFromMain(release, meta)...)
	problems = append(problems, everyChartListed(charts, onDisk)...)

	return problems, nil
}

// codeLines is the file without comment lines: a comment may name what the
// workflow refuses to do.
func codeLines(repoRoot, rel string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, rel))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", rel, err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "#") {
			lines = append(lines, line)
		}
	}

	return lines, nil
}

func chartDestinations(lines []string) []string {
	var problems []string
	for _, line := range lines {
		problems = append(problems, chartDestinationProblems(strings.TrimSpace(line))...)
	}

	return problems
}

func chartDestinationProblems(line string) []string {
	var problems []string
	if directPush.MatchString(line) {
		problems = append(problems, fmt.Sprintf("%s pushes outside cmd/chartpush: %q", ChartsWorkflow, line))
	}
	if m := registryAssign.FindStringSubmatch(line); len(m) > 1 && strings.TrimSpace(m[1]) != privateECRHost {
		problems = append(problems, fmt.Sprintf("%s sets registry to %s, not the private ECR host %s", ChartsWorkflow, m[1], privateECRHost))
	}
	if m := chartpushTarget.FindStringSubmatch(line); len(m) > 1 && m[1] != `"$registry"` {
		problems = append(problems, fmt.Sprintf("%s hands chartpush %s, not \"$registry\"", ChartsWorkflow, m[1]))
	}
	if packagesWrite.MatchString(line) {
		problems = append(problems, ChartsWorkflow+" holds packages: write")
	}

	return problems
}

func chartSigning(lines []string) []string {
	for _, line := range lines {
		if signing.MatchString(line) {
			return []string{ChartsWorkflow + " signs the private copy (cosign or sigstore)"}
		}
	}

	return nil
}

func imagesOnlyFromMain(release bool, workflow *ciscan.Workflow) []string {
	var problems []string
	if release {
		problems = append(problems, ImagesWorkflow+" has a release trigger")
	}
	if job, ok := workflow.Jobs["meta"]; !ok || strings.TrimSpace(job.If) != mainOnly {
		problems = append(problems, fmt.Sprintf("%s: the meta job, which every other job needs, must run only on %s", ImagesWorkflow, mainOnly))
	}

	return problems
}

// hasReleaseTrigger parses the workflow and reads its top-level `on:` in any
// of GitHub's forms: a mapping, a list or a single event name.
func hasReleaseTrigger(repoRoot, rel string) (bool, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, rel))
	if err != nil {
		return false, fmt.Errorf("read %s: %w", rel, err)
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return false, fmt.Errorf("parse %s: %w", rel, err)
	}
	if len(doc.Content) == 0 {
		return false, nil
	}

	return namesRelease(valueOf(doc.Content[0], "on")), nil
}

func valueOf(mapping *yaml.Node, key string) *yaml.Node {
	if mapping.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}

	return nil
}

func namesRelease(on *yaml.Node) bool {
	if on == nil {
		return false
	}
	switch on.Kind {
	case yaml.MappingNode:
		return valueOf(on, "release") != nil
	case yaml.SequenceNode:
		for _, event := range on.Content {
			if event.Value == "release" {
				return true
			}
		}
	case yaml.ScalarNode:
		return on.Value == "release"
	case yaml.DocumentNode, yaml.AliasNode:
		return false
	}

	return false
}

// chartsOnDisk is every chart name under charts/*/Chart.yaml, sorted.
func chartsOnDisk(repoRoot string) ([]string, error) {
	paths, err := filepath.Glob(filepath.Join(repoRoot, "charts", "*", "Chart.yaml"))
	if err != nil {
		return nil, err
	}
	var names []string
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var chart struct {
			Name string `yaml:"name"`
		}
		if err := yaml.Unmarshal(raw, &chart); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
		if chart.Name != "" {
			names = append(names, chart.Name)
		}
	}
	sort.Strings(names)

	return names, nil
}

// everyChartListed is a wiring check: a chart missing from ECR_CHARTS is
// packaged and never pushed, and nothing else would fail.
func everyChartListed(lines, onDisk []string) []string {
	var listed []string
	for _, line := range lines {
		if m := ecrCharts.FindStringSubmatch(line); m != nil {
			listed = strings.Fields(m[1])
		}
	}
	sort.Strings(listed)
	if len(onDisk) > 0 && strings.Join(listed, " ") == strings.Join(onDisk, " ") {
		return nil
	}

	return []string{fmt.Sprintf("%s ECR_CHARTS lists [%s] but charts/*/Chart.yaml names [%s]",
		ChartsWorkflow, strings.Join(listed, " "), strings.Join(onDisk, " "))}
}
