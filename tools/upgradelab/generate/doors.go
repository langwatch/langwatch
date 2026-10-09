package generate

import (
	"bytes"
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

const (
	composeFile   = "dev/scripts/upgrade-rehearsal/compose.yml"
	healthTimeout = 10 * time.Minute
	stderrTail    = 4096
)

// Ports are the host ports the compose override publishes; the doors and the capture reach the stack through them.
type Ports struct{ App, Postgres, Redis, ClickHouse, Private string }

// freePorts asks the OS for five distinct free loopback ports, holding all open until every one is read.
// shortcut: a port can be taken between close and docker's bind; retry the run if compose reports it.
func freePorts() (Ports, error) {
	var found [5]string
	listeners := make([]net.Listener, 0, len(found))
	defer func() {
		for _, listener := range listeners {
			_ = listener.Close()
		}
	}()
	for index := range found {
		listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
		if err != nil {
			return Ports{}, err
		}
		listeners = append(listeners, listener)
		_, found[index], _ = net.SplitHostPort(listener.Addr().String())
	}
	return Ports{App: found[0], Postgres: found[1], Redis: found[2], ClickHouse: found[3], Private: found[4]}, nil
}

func (ports Ports) appURL() string { return "http://localhost:" + ports.App }

func (ports Ports) override() string {
	return `services:
  postgres: {ports: ["` + ports.Postgres + `:5432"]}
  redis: {ports: ["` + ports.Redis + `:6379"]}
  clickhouse: {ports: ["` + ports.ClickHouse + `:8123"]}
  clickhouse-private: {ports: ["` + ports.Private + `:8123"]}
`
}

// Invocation is one child process: its argv, extra environment, stdin and working directory.
type Invocation struct {
	Args  []string
	Env   []string
	Stdin string
	Dir   string
}

// Runner runs one Invocation; tests swap in a fake.
type Runner interface {
	Run(ctx context.Context, invocation Invocation) error
}

// ExecRunner runs an Invocation as a child process: stdout goes to Log; argv and stderr's tail go into
// the error, so argv must never hold a secret (stdin and env may).
type ExecRunner struct{ Log io.Writer }

// Run implements Runner.
func (runner ExecRunner) Run(ctx context.Context, invocation Invocation) error {
	// #nosec G204 -- the doors build argv from the plan; nothing is parsed by a shell
	command := exec.CommandContext(ctx, invocation.Args[0], invocation.Args[1:]...)
	var stderr bytes.Buffer
	command.Dir, command.Env = invocation.Dir, append(os.Environ(), invocation.Env...)
	command.Stdin, command.Stdout, command.Stderr = strings.NewReader(invocation.Stdin), cmp.Or[io.Writer](runner.Log, io.Discard), &stderr
	if err := command.Run(); err != nil {
		text := stderr.String()
		return fmt.Errorf("%s: %w: %s", strings.Join(invocation.Args, " "), err, strings.TrimSpace(text[max(0, len(text)-stderrTail):]))
	}
	return nil
}

// DoorsOptions configures the compose doors. Root defaults to the working directory, Runner to an
// ExecRunner logging to stderr; Out is the empty snapshot directory; Image is required for main@<sha>.
// A zero Ports means free ports are picked per run; tests set it to fixed values.
type DoorsOptions struct {
	Root, Out, Image, Commit string
	Runner                   Runner
	Ports                    Ports
}

// ComposeDoors runs each step against dev/scripts/upgrade-rehearsal/compose.yml (profile old).
type ComposeDoors struct {
	options DoorsOptions
	env     seed.ShapeEnv
	image   string
	runDir  string
	project string
	seed    int64
	seeder  *seed.Seeder
}

// NewComposeDoors refuses a used Out, loads the shape env and writes the env file and ports override.
func NewComposeDoors(plan Plan, options DoorsOptions) (*ComposeDoors, error) {
	if entries, err := os.ReadDir(options.Out); options.Out == "" || (err == nil && len(entries) > 0) {
		return nil, fmt.Errorf("-out %q must name an empty or missing directory", options.Out)
	}
	image, err := imageFor(plan.Request.Release, options.Image)
	if err != nil {
		return nil, err
	}
	env, err := seed.LoadShapeEnv(plan.Request.Shape)
	if err != nil {
		return nil, err
	}
	if options, err = withDefaults(options); err != nil {
		return nil, err
	}
	doors := &ComposeDoors{options: options, env: env, image: image, seed: plan.Request.Seed,
		project: fmt.Sprintf("upgradelab-%s-%d", plan.Request.Shape, plan.Request.Seed)}
	if doors.runDir, err = os.MkdirTemp("", "upgradelab-generate-"); err != nil {
		return nil, err
	}
	if err := doors.writeFiles(); err != nil {
		return nil, err
	}
	return doors, nil
}

func withDefaults(options DoorsOptions) (DoorsOptions, error) {
	var err error
	if options.Runner == nil {
		options.Runner = ExecRunner{Log: os.Stderr}
	}
	if options.Ports == (Ports{}) {
		if options.Ports, err = freePorts(); err != nil {
			return options, err
		}
	}
	if options.Root == "" {
		options.Root, err = os.Getwd()
	}
	return options, err
}

func imageFor(release, override string) (string, error) {
	switch {
	case override != "":
		return override, nil
	case tagRelease.MatchString(release):
		return "langwatch/langwatch:" + release, nil
	}
	sha := strings.TrimPrefix(release, "main@")
	return "", fmt.Errorf("release %s needs -image; build one: git archive %s | docker build -f infra/docker/Dockerfile -t <image> -", release, sha)
}

func (doors *ComposeDoors) writeFiles() error {
	if err := os.WriteFile(filepath.Join(doors.runDir, "shape.env"), []byte(envFileText(doors.env, doors.options.Ports.appURL())), 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(doors.runDir, "ports.yml"), []byte(doors.options.Ports.override()), 0o600)
}

// envFileText is the shape's values and test secrets, its own origin pointed at the published app port.
func envFileText(env seed.ShapeEnv, appURL string) string {
	all := maps.Clone(env.Values)
	maps.Copy(all, env.Secrets)
	all["BASE_HOST"], all["NEXTAUTH_URL"] = appURL, appURL
	var text strings.Builder
	for _, key := range slices.Sorted(maps.Keys(all)) {
		fmt.Fprintf(&text, "%s=%s\n", key, all[key])
	}
	return text.String()
}

// Run implements Doors. Its error never carries a shape secret or the seed account's password.
func (doors *ComposeDoors) Run(ctx context.Context, plan Plan, step Step) error {
	if step.Name == "capture" {
		return doors.redact(doors.capture(ctx, plan))
	}
	if err := doors.runInvocations(ctx, plan, step); err != nil {
		return doors.redact(err)
	}
	switch step.Name {
	case "old-release-up":
		return waitHealthy(ctx, doors.options.Ports.appURL()+"/api/health")
	case "product-seeds":
		return doors.redact(doors.seedProducts(ctx))
	}
	return nil
}

func (doors *ComposeDoors) runInvocations(ctx context.Context, plan Plan, step Step) error {
	invocations, err := doors.Invocations(plan, step)
	if err != nil {
		return err
	}
	for _, invocation := range invocations {
		if err := doors.options.Runner.Run(ctx, invocation); err != nil && !firedOnly(step, err) {
			return err
		}
	}
	return nil
}

// Invocations are the child processes one step runs; capture runs in process and has none.
func (doors *ComposeDoors) Invocations(plan Plan, step Step) ([]Invocation, error) {
	switch step.Name {
	case "stores-up":
		return []Invocation{doors.compose("up", "-d", "--wait", "postgres", "redis", "clickhouse", "clickhouse-private")}, nil
	case "old-release-up":
		return []Invocation{doors.compose("up", "-d", "old-app", "old-worker")}, nil
	case "tenancy-sql":
		return []Invocation{doors.psql(plan.TenancyS)}, nil
	case "product-seeds":
		return []Invocation{doors.psql(accountSQL(doors.seed))}, nil
	case "traffic", "traffic-at-cut":
		return []Invocation{doors.traffic(step)}, nil
	case "pause-worker":
		return []Invocation{doors.compose("pause", "old-worker")}, nil
	}
	return nil, fmt.Errorf("no door for step %q", step.Name)
}

func (doors *ComposeDoors) compose(args ...string) Invocation {
	argv := []string{"docker", "compose", "-f", filepath.Join(doors.options.Root, composeFile),
		"-f", filepath.Join(doors.runDir, "ports.yml"), "--profile", "old"}
	return Invocation{Args: append(argv, args...), Dir: doors.options.Root, Env: []string{
		"OLD_IMAGE=" + doors.image,
		"HEAD_IMAGE=" + doors.image, // the head profile never starts; compose still interpolates it
		"REHEARSAL_ENV_FILE=" + filepath.Join(doors.runDir, "shape.env"),
		"REHEARSAL_PROJECT=" + doors.project,
		"OLD_APP_PORT=" + doors.options.Ports.App,
	}}
}

func (doors *ComposeDoors) psql(sql string) Invocation {
	invocation := doors.compose("exec", "-T", "postgres", "psql", "-U", "prisma", "-d", "mydb", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-")
	invocation.Stdin = sql
	return invocation
}

// seedProducts signs in as the account accountSQL wrote and creates each product kind through the old app's doors.
func (doors *ComposeDoors) seedProducts(ctx context.Context) error {
	email, password := seedAccount(doors.seed)
	doors.seeder = seed.NewSeeder(seed.ProductInput{AppURL: doors.options.Ports.appURL(), Email: email, Password: password, Label: doors.project})
	return doors.seeder.Seed(ctx)
}

// seedAccount is the seed's credential account; seed-derived so a restored copy can sign in again.
func seedAccount(seedValue int64) (email, password string) {
	n := strconv.FormatInt(seedValue, 10)
	return "seed+" + n + "@snapshot.test", "snapshot-test-seed-password-" + n
}

// accountSQL hashes in a scratch pgcrypto schema it drops in the same transaction, so the old schema keeps no extension.
func accountSQL(seedValue int64) string {
	email, password := seedAccount(seedValue)
	user := sqlString(fmt.Sprintf("snap_seed_user_%d", seedValue))
	return "SET search_path TO mydb;\nBEGIN;\nCREATE SCHEMA upgradelab_crypto;\nCREATE EXTENSION pgcrypto SCHEMA upgradelab_crypto;\n" +
		`INSERT INTO "User" (id, name, email, "emailVerified") VALUES (` + user + `, 'Snapshot seed', ` + sqlString(email) + ", true);\n" +
		`INSERT INTO "Account" (id, "userId", type, provider, issuer, "providerAccountId", password) VALUES (` +
		sqlString(fmt.Sprintf("snap_seed_account_%d", seedValue)) + ", " + user + ", 'credentials', 'credential', 'local:credential', " + user +
		", '$2b$' || substr(upgradelab_crypto.crypt(" + sqlString(password) + ", upgradelab_crypto.gen_salt('bf', 10)), 5));\n" +
		"DROP SCHEMA upgradelab_crypto CASCADE;\nCOMMIT;\n"
}

func sqlString(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func (doors *ComposeDoors) traffic(step Step) Invocation {
	args := []string{"go", "run", "./cmd/workerrun", "-url", doors.options.Ports.appURL(), "-families", step.Args["families"],
		"-n", step.Args["n"], "-seed", step.Args["seed"], "-run-dir", filepath.Join(doors.runDir, step.Name)}
	if step.Name == "traffic-at-cut" {
		args = append(args, "-deadline", "20s", "-drain", "1s")
	}
	return Invocation{Args: args, Dir: doors.options.Root}
}

// firedOnly: at the cut the worker is paused, so workerrun's exit 1 (fired, never read back) is the point.
func firedOnly(step Step, err error) bool {
	var exit interface{ ExitCode() int }
	return step.Name == "traffic-at-cut" && errors.As(err, &exit) && exit.ExitCode() == 1
}

func waitHealthy(ctx context.Context, url string) error {
	ctx, cancel := context.WithTimeout(ctx, healthTimeout)
	defer cancel()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for !healthy(ctx, url) {
		select {
		case <-ctx.Done():
			return fmt.Errorf("%s never answered 2xx: %w", url, ctx.Err())
		case <-ticker.C:
		}
	}
	return nil
}

func healthy(ctx context.Context, url string) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return false
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return false
	}
	_ = response.Body.Close()
	return response.StatusCode/100 == 2
}

func (doors *ComposeDoors) capture(ctx context.Context, plan Plan) error {
	stores, err := doors.stores()
	if err != nil {
		return err
	}
	if _, err = snapshot.Capture(ctx, snapshot.CaptureInput{Dir: doors.options.Out, Stores: stores, Meta: doors.meta(plan), Scrubber: doors.scrubber(plan)}); err != nil {
		return err
	}
	return doors.checkExpect(ctx)
}

// checkExpect asks the still-running old app, after capture, whether every seeded kind is there.
func (doors *ComposeDoors) checkExpect(ctx context.Context) error {
	if doors.seeder == nil {
		return errors.New("expect: product-seeds never ran in this process, so there is nothing to check")
	}
	counts, err := doors.seeder.Count(ctx)
	if err != nil {
		return fmt.Errorf("expect: %w", err)
	}
	if err := seed.ExpectedKinds().Check(counts); err != nil {
		return fmt.Errorf("expect: %w", err)
	}
	return nil
}

func (doors *ComposeDoors) stores() (snapshot.Stores, error) {
	stores := snapshot.Stores{ClickHouse: map[string]snapshot.ClickHouse{}}
	var err error
	if stores.Postgres, err = snapshot.NewPostgresCLI("postgresql://prisma:prisma@localhost:" + doors.options.Ports.Postgres + "/mydb?schema=mydb"); err != nil {
		return stores, err
	}
	if stores.Redis, err = snapshot.NewRedisRESP("redis://localhost:" + doors.options.Ports.Redis + "/0"); err != nil {
		return stores, err
	}
	for target, raw := range clickHouseTargets(doors.env, doors.options.Ports) {
		if stores.ClickHouse[target], err = snapshot.NewClickHouseHTTP(raw); err != nil {
			return stores, err
		}
	}
	return stores, nil
}

// clickHouseTargets is shared plus one private-<label> per CLICKHOUSE_URL__<label>__<org> route.
// shortcut: every label maps to the one clickhouse-private container; add containers when a shape routes two.
func clickHouseTargets(env seed.ShapeEnv, ports Ports) map[string]string {
	targets := map[string]string{"shared": "http://default:langwatch@localhost:" + ports.ClickHouse + "/langwatch"}
	for _, name := range env.SecretNames {
		if rest, ok := strings.CutPrefix(name, "CLICKHOUSE_URL__"); ok {
			label, _, _ := strings.Cut(rest, "__")
			targets["private-"+label] = "http://default:langwatch@localhost:" + ports.Private + "/langwatch"
		}
	}
	return targets
}

// meta is the producer's half of the manifest: secret names only, never their values.
func (doors *ComposeDoors) meta(plan Plan) snapshot.Manifest {
	request := plan.Request
	return snapshot.Manifest{
		ID:              fmt.Sprintf("%s-%s-%s-seed%d", request.Shape, strings.ReplaceAll(request.Release, "@", "-"), request.Volume, request.Seed),
		Recipe:          snapshot.Recipe{Version: seed.RecipeVersion, Hash: plan.Digest()},
		Release:         request.Release,
		Image:           doors.image,
		Shape:           snapshot.Shape{Name: request.Shape, Env: doors.env.Values, SecretNames: doors.env.SecretNames},
		Overlays:        []string{},
		Seed:            request.Seed,
		Anchor:          request.Anchor.UTC(),
		GeneratorCommit: doors.options.Commit,
		PostgresSchema:  "mydb",
	}
}

// scrubber allows the tenancy's API keys and the shape's own test secrets, exactly.
func (doors *ComposeDoors) scrubber(plan Plan) snapshot.Scrubber {
	allow := plan.Tenancy.APIKeys()
	for _, name := range doors.env.SecretNames {
		allow = append(allow, doors.env.Secrets[name])
	}
	return snapshot.Scrubber{Allow: allow}
}

// redact swaps every secret value for its name, longest first so no secret leaks as a suffix.
func (doors *ComposeDoors) redact(err error) error {
	if err == nil {
		return nil
	}
	secrets := map[string]string{}
	maps.Copy(secrets, doors.env.Secrets)
	_, secrets["SEED_PASSWORD"] = seedAccount(doors.seed)
	names := slices.SortedFunc(maps.Keys(secrets), func(a, b string) int { return len(secrets[b]) - len(secrets[a]) })
	text := err.Error()
	for _, name := range names {
		if secrets[name] != "" {
			text = strings.ReplaceAll(text, secrets[name], "<"+name+">")
		}
	}
	return errors.New(text)
}
