// Package seed holds what a typical snapshot is made of: shape env files, the tenancy rows and their
// SQL at the old schema, the product kinds the old tRPC seeds, and coverage.json (plan section 3.4).
package seed

import (
	"bufio"
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

//go:embed env/*.env coverage.json
var files embed.FS

// Shapes are the four deployment shapes (plan section 2.1).
var Shapes = []string{"saas", "hybrid", "sh-licensed", "sh-free"}

var secretName = regexp.MustCompile(`SECRET|PEPPER|PASSWORD|TOKEN|_KEY$|^DATAPLANE_S3__|^CLICKHOUSE_URL__`)

// ShapeEnv is a shape's env split into manifest-safe values and the names of its test secrets.
type ShapeEnv struct {
	Values      map[string]string
	Secrets     map[string]string
	SecretNames []string
}

// LoadShapeEnv reads common.env then <shape>.env; later lines win.
func LoadShapeEnv(shape string) (ShapeEnv, error) {
	if !slices.Contains(Shapes, shape) {
		return ShapeEnv{}, fmt.Errorf("unknown shape %q: want one of %s", shape, strings.Join(Shapes, ", "))
	}
	env := ShapeEnv{Values: map[string]string{}, Secrets: map[string]string{}}
	for _, name := range []string{"env/common.env", "env/" + shape + ".env"} {
		data, err := files.ReadFile(name)
		if err != nil {
			return ShapeEnv{}, err
		}
		env.parse(string(data))
	}
	for key := range env.Secrets {
		env.SecretNames = append(env.SecretNames, key)
	}
	slices.Sort(env.SecretNames)
	return env, nil
}

// parse adds each KEY=value line to Values, or to Secrets when the name looks secret.
func (env ShapeEnv) parse(text string) {
	scanner := bufio.NewScanner(strings.NewReader(text))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		key, value, ok := strings.Cut(line, "=")
		if line == "" || strings.HasPrefix(line, "#") || !ok {
			continue
		}
		if secretName.MatchString(key) {
			env.Secrets[key] = value
		} else {
			env.Values[key] = value
		}
	}
}

// Coverage is coverage.json.
type Coverage struct {
	Steps            map[string]CoverageEntry `json:"steps"`
	SystemMigrations map[string]CoverageEntry `json:"systemMigrations"`
}

// CoverageEntry says what feeds one step.
type CoverageEntry struct {
	Status string   `json:"status"`
	Seed   string   `json:"seed"`
	Cells  []string `json:"cells"`
	Note   string   `json:"note"`
}

// LoadCoverage reads coverage.json.
func LoadCoverage() (Coverage, error) {
	var coverage Coverage
	data, err := files.ReadFile("coverage.json")
	if err != nil {
		return coverage, err
	}
	err = json.Unmarshal(data, &coverage)
	return coverage, err
}

// ProductKind is one kind the old image's tRPC seeds; Unseedable says why a kind has no seed.
type ProductKind struct {
	Kind, Create, Unseedable string
}

// ProductKinds mirrors dev/scripts/upgrade-rehearsal/seed/product.mjs; the door ports each input.
var ProductKinds = []ProductKind{
	{Kind: "privacy", Create: "dataPrivacy.setForScope"},
	{Kind: "retention", Create: "dataRetention.setForScope"},
	{Kind: "annotation", Create: "annotation.create"},
	{Kind: "workflow", Create: "workflow.create"},
	{Kind: "slack", Create: "slackIntegration.create"},
	{Kind: "report", Create: "dashboards.create"},
	{Kind: "suite", Create: "suites.create"},
	{Kind: "license", Create: "license.upload", Unseedable: "self-hosted licensed shape only"},
	{Kind: "sso", Unseedable: "no headless door: SSO connection by tenancy SQL (C2)"},
	{Kind: "coding-assistant", Unseedable: "no headless seed: the old image's codingAgents router only reads"},
}
