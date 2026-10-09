package generate

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls []Invocation
	err   error
}

func (runner *fakeRunner) Run(_ context.Context, invocation Invocation) error {
	runner.calls = append(runner.calls, invocation)
	return runner.err
}

// exitCode stands in for *exec.ExitError.
type exitCode int

func (code exitCode) Error() string { return "exit status " + strconv.Itoa(int(code)) }
func (code exitCode) ExitCode() int { return int(code) }

func newTestDoors(t *testing.T, shape string, runner Runner) (*ComposeDoors, Plan) {
	t.Helper()
	release := "3.20.1"
	if shape == "saas" || shape == "hybrid" {
		release = "main@abcdef1"
	}
	plan := mustBuild(t, shape, release, 1)
	doors, err := NewComposeDoors(plan, DoorsOptions{Root: "/repo", Out: filepath.Join(t.TempDir(), "out"), Image: "old:image", Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(doors.runDir) })
	return doors, plan
}

func stepNamed(plan Plan, name string) Step {
	index := slices.IndexFunc(plan.Steps, func(step Step) bool { return step.Name == name })
	return plan.Steps[index]
}

func TestDoorsBuildEachCommandLine(t *testing.T) {
	doors, plan := newTestDoors(t, "saas", &fakeRunner{})
	prefix := "docker compose -f /repo/dev/scripts/upgrade-rehearsal/compose.yml -f " + filepath.Join(doors.runDir, "ports.yml") + " --profile old "
	want := map[string]string{
		"stores-up":      prefix + "up -d --wait postgres redis clickhouse clickhouse-private",
		"old-release-up": prefix + "up -d old-app old-worker",
		"tenancy-sql":    prefix + "exec -T postgres psql -U prisma -d mydb -q -v ON_ERROR_STOP=1 -f -",
		"product-seeds":  "node /repo/dev/scripts/upgrade-rehearsal/seed/product.mjs seed",
		"traffic":        "go run ./cmd/workerrun -url http://localhost:15560 -families " + strings.Join(trafficKinds, ",") + " -n 20 -seed 1",
		"pause-worker":   prefix + "pause old-worker",
		"traffic-at-cut": "-families otlp -n 5 -seed 1 -run-dir " + filepath.Join(doors.runDir, "traffic-at-cut") + " -deadline 20s -drain 1s",
	}
	for _, step := range plan.Steps[:len(plan.Steps)-1] {
		invocations, err := doors.Invocations(plan, step)
		if err != nil {
			t.Fatal(err)
		}
		lines := make([]string, 0, len(invocations))
		for _, invocation := range invocations {
			lines = append(lines, strings.Join(invocation.Args, " "))
		}
		if line := strings.Join(lines, " | "); !strings.Contains(line, want[step.Name]) {
			t.Errorf("%s:\n got %s\nwant %s", step.Name, line, want[step.Name])
		}
	}
	tenancy, _ := doors.Invocations(plan, stepNamed(plan, "tenancy-sql"))
	if tenancy[0].Stdin != plan.TenancyS {
		t.Error("tenancy-sql must feed the plan's SQL on stdin")
	}
	if _, err := doors.Invocations(plan, Step{Name: "nope"}); err == nil {
		t.Error("an unknown step must be refused")
	}
}

func TestDoorsAssembleTheEnvironment(t *testing.T) {
	doors, plan := newTestDoors(t, "saas", &fakeRunner{})
	stores, _ := doors.Invocations(plan, stepNamed(plan, "stores-up"))
	for _, want := range []string{"OLD_IMAGE=old:image", "REHEARSAL_ENV_FILE=" + filepath.Join(doors.runDir, "shape.env"), "REHEARSAL_PROJECT=upgradelab-saas-1", "OLD_APP_PORT=15560"} {
		if !slices.Contains(stores[0].Env, want) {
			t.Errorf("compose env lacks %s", want)
		}
	}
	path := filepath.Join(doors.runDir, "shape.env")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{"BASE_HOST=" + appURL + "\n", "IS_SAAS=true\n", "NEXTAUTH_SECRET=" + doors.env.Secrets["NEXTAUTH_SECRET"] + "\n"} {
		if !strings.Contains(text, want) {
			t.Errorf("env file lacks %q", want)
		}
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Errorf("env file mode %v, want 0600", info.Mode().Perm())
	}
	seeds, _ := doors.Invocations(plan, stepNamed(plan, "product-seeds"))
	if !slices.Contains(seeds[1].Env, "SEED_EMAIL=seed+1@snapshot.test") || !strings.Contains(seeds[0].Stdin, "DROP SCHEMA upgradelab_crypto") {
		t.Errorf("product seeds: env %v", seeds[1].Env)
	}
	for _, step := range plan.Steps[:len(plan.Steps)-1] {
		invocations, _ := doors.Invocations(plan, step)
		for _, invocation := range invocations {
			for _, value := range doors.env.Secrets {
				if strings.Contains(strings.Join(invocation.Args, " "), value) {
					t.Errorf("%s puts a secret on the command line", step.Name)
				}
			}
		}
	}
}

func TestDoorErrorsNeverCarryASecret(t *testing.T) {
	runner := &fakeRunner{}
	doors, plan := newTestDoors(t, "hybrid", runner)
	_, password := seedAccount(1)
	values := append(slices.Collect(maps.Values(doors.env.Secrets)), password)
	runner.err = fmt.Errorf("psql: exit status 3: ERROR near %s", strings.Join(values, " "))
	err := doors.Run(context.Background(), plan, stepNamed(plan, "product-seeds"))
	if err == nil {
		t.Fatal("a failing runner must fail the door")
	}
	for _, value := range values {
		if strings.Contains(err.Error(), value) {
			t.Fatalf("door error leaks a secret: %v", err)
		}
	}
	if !strings.Contains(err.Error(), "<SEED_PASSWORD>") || !strings.Contains(err.Error(), "<NEXTAUTH_SECRET>") {
		t.Errorf("door error names no redacted secret: %v", err)
	}
}

func TestOnlyCutTrafficToleratesUnreadItems(t *testing.T) {
	cases := []struct {
		step string
		code exitCode
		ok   bool
	}{{"traffic-at-cut", 1, true}, {"traffic-at-cut", 2, false}, {"traffic", 1, false}}
	for _, test := range cases {
		doors, plan := newTestDoors(t, "saas", &fakeRunner{err: fmt.Errorf("go run: %w", test.code)})
		err := doors.Run(context.Background(), plan, stepNamed(plan, test.step))
		if (err == nil) != test.ok {
			t.Errorf("%s exit %d: err %v", test.step, test.code, err)
		}
	}
}

func TestCaptureMetaNamesSecretsWithoutValues(t *testing.T) {
	doors, plan := newTestDoors(t, "hybrid", &fakeRunner{})
	meta := doors.meta(plan)
	data, _ := json.Marshal(meta)
	for name, value := range doors.env.Secrets {
		if strings.Contains(string(data), value) {
			t.Errorf("manifest meta carries %s's value", name)
		}
	}
	if !maps.Equal(meta.Shape.Env, doors.env.Values) || !slices.Equal(meta.Shape.SecretNames, doors.env.SecretNames) {
		t.Error("manifest shape must be the shape env's values and secret names")
	}
	if meta.Recipe.Hash != plan.Digest() || meta.Image != "old:image" || meta.Release != "main@abcdef1" {
		t.Errorf("manifest meta: %+v", meta)
	}
	allow := doors.scrubber(plan).Allow
	for _, want := range append(plan.Tenancy.APIKeys(), doors.env.Secrets["NEXTAUTH_SECRET"]) {
		if !slices.Contains(allow, want) {
			t.Errorf("scrub allow list lacks a test value")
		}
	}
	targets := clickHouseTargets(doors.env)
	if len(targets) != 2 || targets["shared"] == "" || targets["private-snap"] == "" {
		t.Errorf("clickhouse targets: %v", slices.Sorted(maps.Keys(targets)))
	}
}

func TestDoorsRefuseBeforeBooting(t *testing.T) {
	if image, err := imageFor("3.20.1", ""); err != nil || image != "langwatch/langwatch:3.20.1" {
		t.Errorf("a tag defaults to its published image: %s %v", image, err)
	}
	if _, err := imageFor("main@abcdef1", ""); err == nil || !strings.Contains(err.Error(), "docker build") {
		t.Errorf("main@<sha> without -image must say how to build one: %v", err)
	}
	used := t.TempDir()
	if err := os.WriteFile(filepath.Join(used, "x"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	plan := mustBuild(t, "sh-free", "3.20.1", 1)
	if _, err := NewComposeDoors(plan, DoorsOptions{Root: "/repo", Out: used, Runner: &fakeRunner{}}); err == nil {
		t.Error("a non-empty -out must be refused before the stack boots")
	}
}
