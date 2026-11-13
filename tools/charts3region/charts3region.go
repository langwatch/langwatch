// Package charts3region checks that the langwatch chart hands
// app.dataplane.providers.awsS3.region (value or secretKeyRef) to every process carrying the S3
// settings as S3_REGION, and renders no S3_REGION when it is unset, so the
// shared region rule decides.
//
// Spec: specs/features/scenarios/externalize-event-byte-content.feature
package charts3region

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// The deployments that must always carry the region.
const (
	App     = "templates/app/deployment.yaml"
	Workers = "templates/workers/deployment.yaml"
)

// Region is the value the checks set and expect back.
const Region = "eu-north1"

// SecretRegion is how Values reports a region read from the secret s3, key region.
const SecretRegion = "secret:s3/region"

// awsS3Values renders the awsS3 provider with an endpoint and keys, the posture
// R2 broke, plus a region line when region (YAML for the field) is not empty.
func awsS3Values(region string) string {
	regionLine := ""
	if region != "" {
		regionLine = "        region: " + region + "\n"
	}
	return "app:\n  dataplane:\n    enabled: true\n    provider: awsS3\n    providers:\n      awsS3:\n" +
		"        endpoint: { value: \"https://storage.eu-north1.example\" }\n" +
		"        accessKeyId: { value: key-marker }\n        secretAccessKey: { value: secret-marker }\n" +
		regionLine + "  storedObjects:\n    localFilesystem: { enabled: false }\n"
}

// Render renders the whole chart with the given values files.
type Render func(valuesFiles ...string) (string, error)

// Assertion checks every container the render declares.
type Assertion func([]Container) error

// Check is one case: its name, the values it adds, and what the render must hold.
type Check struct {
	Name   string
	Values string
	Expect Assertion
}

// Checks are the cases in order: region as a value, from a secret, then unset.
var Checks = []Check{
	{
		Name:   "the region reaches the app, the workers and every container with the S3 settings",
		Values: awsS3Values("{ value: " + Region + " }"),
		Expect: RegionEverywhere(Region),
	},
	{
		Name:   "a region from a secret reaches every container with the S3 settings",
		Values: awsS3Values("{ secretKeyRef: { name: s3, key: region } }"),
		Expect: RegionEverywhere(SecretRegion),
	},
	{
		Name:   "with no region set nothing renders S3_REGION",
		Values: awsS3Values(""),
		Expect: NoRegion,
	},
}

// Run renders the chart with the check's values written to a file under dir.
func (c Check) Run(render Render, dir string) error {
	path := filepath.Join(dir, "values.yaml")
	if err := os.WriteFile(path, []byte(c.Values), 0o600); err != nil {
		return err
	}
	manifest, err := render(path)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	containers, err := Containers(manifest)
	if err != nil {
		return err
	}
	return c.Expect(containers)
}

// Container is one container or init container and the template it came from.
type Container struct {
	Source string
	Name   string
	Env    []EnvVar
}

// EnvVar is one env entry, a literal value or a secret reference.
type EnvVar struct {
	Name      string `yaml:"name"`
	Value     string `yaml:"value"`
	ValueFrom struct {
		SecretKeyRef struct {
			Name string `yaml:"name"`
			Key  string `yaml:"key"`
		} `yaml:"secretKeyRef"`
	} `yaml:"valueFrom"`
}

// Values lists every value the container declares for name, in order; a secret
// reference reads as secret:<name>/<key>.
func (c Container) Values(name string) []string {
	var values []string
	for _, env := range c.Env {
		if env.Name == name {
			values = append(values, env.literal())
		}
	}
	return values
}

func (e EnvVar) literal() string {
	if ref := e.ValueFrom.SecretKeyRef; ref.Name != "" {
		return "secret:" + ref.Name + "/" + ref.Key
	}
	return e.Value
}

// Containers reads every container and init container of every rendered document.
func Containers(manifest string) ([]Container, error) {
	var all []Container
	for doc := range strings.SplitSeq(manifest, "\n---") {
		found, err := documentContainers(doc)
		if err != nil {
			return nil, err
		}
		all = append(all, found...)
	}
	return all, nil
}

func documentContainers(doc string) ([]Container, error) {
	var root yaml.Node
	if err := yaml.NewDecoder(strings.NewReader(doc)).Decode(&root); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	source := sourceOf(doc)
	var found []Container
	walk(&root, func(list *yaml.Node) {
		for _, item := range list.Content {
			var container struct {
				Name string   `yaml:"name"`
				Env  []EnvVar `yaml:"env"`
			}
			if item.Decode(&container) == nil {
				found = append(found, Container{Source: source, Name: container.Name, Env: container.Env})
			}
		}
	})
	return found, nil
}

// walk calls visit with every containers or initContainers list under node.
func walk(node *yaml.Node, visit func(*yaml.Node)) {
	if node.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(node.Content); i += 2 {
			key, value := node.Content[i].Value, node.Content[i+1]
			if (key == "containers" || key == "initContainers") && value.Kind == yaml.SequenceNode {
				visit(value)
			}
		}
	}
	for _, child := range node.Content {
		walk(child, visit)
	}
}

func sourceOf(doc string) string {
	for line := range strings.SplitSeq(doc, "\n") {
		if rest, ok := strings.CutPrefix(line, "# Source: "); ok {
			_, path, _ := strings.Cut(rest, "/")
			return path
		}
	}
	return ""
}

// RegionEverywhere asserts one S3_REGION of want on the app, the workers, and
// every container carrying S3_BUCKET_NAME (hooks and jobs included).
func RegionEverywhere(want string) Assertion {
	return func(containers []Container) error { return regionEverywhere(containers, want) }
}

func regionEverywhere(containers []Container, want string) error {
	seen := map[string]bool{}
	var problems []string
	for _, container := range containers {
		if problem := regionProblem(container, want, seen); problem != "" {
			problems = append(problems, problem)
		}
	}
	for _, required := range []string{App, Workers} {
		if !seen[required] {
			problems = append(problems, required+" carries no S3 settings")
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("want S3_REGION %q: %s", want, strings.Join(problems, "; "))
	}
	return nil
}

// regionProblem describes a container with the S3 settings but not exactly one
// S3_REGION of want, noting in seen the source of every container with them.
func regionProblem(container Container, want string, seen map[string]bool) string {
	if len(container.Values("S3_BUCKET_NAME")) == 0 {
		return ""
	}
	seen[container.Source] = true
	if got := container.Values("S3_REGION"); len(got) != 1 || got[0] != want {
		return fmt.Sprintf("%s %s has S3_REGION %q", container.Source, container.Name, got)
	}
	return ""
}

// NoRegion asserts no container renders S3_REGION.
func NoRegion(containers []Container) error {
	for _, container := range containers {
		if got := container.Values("S3_REGION"); len(got) > 0 {
			return fmt.Errorf("%s %s renders S3_REGION %q with no region set", container.Source, container.Name, got)
		}
	}
	return nil
}

// HelmRender renders the chart at chartDir with helm on PATH.
func HelmRender(chartDir string) Render {
	return func(valuesFiles ...string) (string, error) {
		args := []string{"template", "lw", chartDir, "--set", "autogen.enabled=true"}
		for _, file := range valuesFiles {
			args = append(args, "-f", file)
		}
		var stderr bytes.Buffer
		cmd := exec.CommandContext(context.Background(), "helm", args...)
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("helm template: %w: %s", err, stderr.String())
		}
		return string(out), nil
	}
}
