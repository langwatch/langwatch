package cell

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// DedicatedPrefix is the only database name a cell creates, drops or writes (ruling D7).
const DedicatedPrefix = "upgradelab_"

// Stores are one cell's dedicated databases on haven's native servers, plus its own Redis.
type Stores struct {
	PostgresBase, ClickHouseBase string // server URLs with credentials, no database
	Name                         string // upgradelab_<cell>
	RedisPort                    string
	Private                      []string       // private ClickHouse labels (hybrid)
	S3                           map[string]int // storagesim port per object target: "" shared, else a private label
	IDP                          int            // idpsim port, for profiles that sign in through an identity provider
}

// DatabaseURL is the Prisma URL both releases share; schema mydb matches the tenancy SQL.
func (stores Stores) DatabaseURL() string {
	return stores.PostgresBase + "/" + stores.Name + "?schema=mydb"
}

func (stores Stores) psqlURL() string { return stores.PostgresBase + "/" + stores.Name }

// ClickHouseURL is the shared target, or a private one by label.
func (stores Stores) ClickHouseURL(label string) string {
	if label == "" {
		return stores.ClickHouseBase + "/" + stores.Name
	}
	return stores.ClickHouseBase + "/" + stores.Name + "_p_" + label
}

// queryURL is where the harness posts a query against a target: ClickHouse's HTTP door takes the
// database as a parameter, never as the path the apps' URLs carry.
func (stores Stores) queryURL(label string) string {
	database := stores.Name
	if label != "" {
		database += "_p_" + label
	}
	return stores.ClickHouseBase + "/?database=" + database
}

// RedisURL is the cell's own redis-server; the branch reads no db index, so no shared server is safe.
func (stores Stores) RedisURL() string { return "redis://127.0.0.1:" + stores.RedisPort }

// HavenServers reads `haven db url`: this checkout's native Postgres and ClickHouse, database stripped.
func HavenServers(ctx context.Context) (postgres, clickhouse string, err error) {
	out, err := exec.CommandContext(ctx, "haven", "db", "url").Output()
	if err != nil {
		return "", "", fmt.Errorf("haven db url: %w (start haven, or pass -postgres-base and -clickhouse-base)", err)
	}
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && fields[0] == "postgres" {
			postgres = serverOf(fields[1])
		}
		if len(fields) == 2 && fields[0] == "clickhouse" {
			clickhouse = serverOf(fields[1])
		}
	}
	if postgres == "" || clickhouse == "" {
		return "", "", errors.New("haven db url printed no postgres or clickhouse line")
	}
	return postgres, clickhouse, nil
}

// serverOf drops the path (the database) and any query from a store URL.
func serverOf(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	parsed.Path, parsed.RawQuery = "", ""
	return parsed.String()
}

// CheckDedicated refuses any name a cell may not own.
func CheckDedicated(name string) error {
	if !strings.HasPrefix(name, DedicatedPrefix) || len(name) == len(DedicatedPrefix) {
		return fmt.Errorf("refusing database %q: a cell owns only databases named %s<name>", name, DedicatedPrefix)
	}
	return nil
}

// Fresh drops and recreates the cell's databases: they are dedicated, so a re-run starts clean.
func (stores Stores) Fresh(ctx context.Context) error {
	if err := CheckDedicated(stores.Name); err != nil {
		return err
	}
	admin := stores.PostgresBase + "/postgres"
	for _, statement := range []string{
		`DROP DATABASE IF EXISTS "` + stores.Name + `" WITH (FORCE)`,
		`CREATE DATABASE "` + stores.Name + `"`,
	} {
		if _, err := psql(ctx, admin, statement); err != nil {
			return err
		}
	}
	for _, database := range stores.clickHouseDatabases() {
		if err := clickhouseExec(ctx, stores.ClickHouseBase, "DROP DATABASE IF EXISTS "+database); err != nil {
			return err
		}
		if err := clickhouseExec(ctx, stores.ClickHouseBase, "CREATE DATABASE "+database); err != nil {
			return err
		}
	}
	return nil
}

// Drop removes the cell's databases.
func (stores Stores) Drop(ctx context.Context) error {
	if err := CheckDedicated(stores.Name); err != nil {
		return err
	}
	_, err := psql(ctx, stores.PostgresBase+"/postgres", `DROP DATABASE IF EXISTS "`+stores.Name+`" WITH (FORCE)`)
	for _, database := range stores.clickHouseDatabases() {
		err = errors.Join(err, clickhouseExec(ctx, stores.ClickHouseBase, "DROP DATABASE IF EXISTS "+database))
	}
	return err
}

func (stores Stores) clickHouseDatabases() []string {
	databases := []string{stores.Name}
	for _, label := range stores.Private {
		databases = append(databases, stores.Name+"_p_"+label)
	}
	return databases
}

// psql runs one statement and answers its unaligned rows.
func psql(ctx context.Context, databaseURL, statement string) (string, error) {
	command := exec.CommandContext(ctx, "psql", databaseURL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement) // #nosec G204 -- fixed binary, harness-built SQL.
	out, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("psql %.80s: %w: %s", statement, err, tail(out))
	}
	return strings.TrimSpace(string(out)), nil
}

// psqlFile feeds a script on stdin, as the compose doors do for the tenancy SQL.
func psqlFile(ctx context.Context, databaseURL, script string) error {
	command := exec.CommandContext(ctx, "psql", databaseURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-") // #nosec G204 -- fixed binary.
	command.Stdin = strings.NewReader(script)
	if out, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("psql script: %w: %s", err, tail(out))
	}
	return nil
}

func tail(out []byte) string {
	const keep = 600
	return strings.TrimSpace(string(out[max(0, len(out)-keep):]))
}

// FreePort asks the kernel for a port and releases it; ponytail: a race until bind, as in generate's freePorts.
func FreePort() (int, error) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = listener.Close() }()
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("listener has no TCP address")
	}
	return address.Port, nil
}

// Proc is one child process group the cell started; Stop always ends the whole group.
type Proc struct {
	Name    string
	Started time.Time
	command *exec.Cmd
	done    chan error
}

// ProcSpec is what to start: argv in Dir with exactly Env, output to Log.
type ProcSpec struct {
	Name, Dir, Log string
	Args, Env      []string
}

// Start launches spec in its own process group; Env is the whole environment, never the parent's.
func Start(spec ProcSpec) (*Proc, error) {
	logFile, err := os.Create(filepath.Clean(spec.Log))
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(context.Background(), spec.Args[0], spec.Args[1:]...) // #nosec G204 -- argv built by the harness; the group outlives any ctx, Stop ends it.
	command.Dir, command.Env, command.Stdout, command.Stderr = spec.Dir, spec.Env, logFile, logFile
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("start %s: %w", spec.Name, err)
	}
	proc := &Proc{Name: spec.Name, Started: time.Now(), command: command, done: make(chan error, 1)}
	go func() {
		proc.done <- command.Wait()
		_ = logFile.Close()
	}()
	return proc, nil
}

// Signal sends sig to the whole group.
func (proc *Proc) Signal(sig syscall.Signal) {
	_ = syscall.Kill(-proc.command.Process.Pid, sig)
}

// Exited answers whether the process ended, and how.
func (proc *Proc) Exited() (bool, error) {
	select {
	case err := <-proc.done:
		proc.done <- err
		return true, err
	default:
		return false, nil
	}
}

// Wait blocks until the process ends or ctx does.
func (proc *Proc) Wait(ctx context.Context) error {
	select {
	case err := <-proc.done:
		proc.done <- err
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Stop resumes a paused group, asks it to end, and kills it after grace.
func (proc *Proc) Stop(grace time.Duration) {
	if exited, _ := proc.Exited(); exited {
		return
	}
	proc.Signal(syscall.SIGCONT)
	proc.Signal(syscall.SIGTERM)
	ctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	if proc.Wait(ctx) != nil {
		proc.Signal(syscall.SIGKILL)
	}
}

// Env renders a map as KEY=value lines, sorted for a stable log.
func Env(values map[string]string) []string {
	lines := make([]string, 0, len(values))
	for key, value := range values {
		lines = append(lines, key+"="+value)
	}
	return lines
}

func itoa(value int) string { return strconv.Itoa(value) }

// The argv each release runs: built output only, never tsx, vite dev or watch (ruling 2026-10-10).
// Head's start is the release image's CMD (infra/docker/Dockerfile): apps/api and apps/worker start.
var (
	FromAppArgs    = []string{"pnpm", "-s", "run", "runtime:app"}
	FromWorkerArgs = []string{"pnpm", "-s", "run", "runtime:workers"}
	HeadStartArgs  = []string{"pnpm", "--silent", "run", "start"}
	// FromStartup is main's preflight, in order, from origin/main platform/app/scripts/start-runtime.sh.
	FromStartup = [][]string{{"start:prepare:db"}, {"task", "system-migrations"}}
)

// headBuildScript is the release image's install and build steps (infra/docker/Dockerfile), run in head's
// checkout; the install keeps node_modules in step with packages head added.
const headBuildScript = `pnpm install --frozen-lockfile --prefer-offline && pnpm start:prepare:files && pnpm ensure:built && pnpm exec tsc -b --builders 16 tsconfig.build.json && pnpm --filter "@langwatch/ui..." --filter "@langwatch/platform-api..." --filter "@langwatch/worker..." run build`

// BuildStamp sits in node_modules, which git ignores, so a build never dirties the checkout.
const BuildStamp = "node_modules/.upgradelab-build"

// Build is one release's build: Args run in Root/Dir, skipped while the stamp records HEAD and Output exists.
type Build struct {
	Root, Dir, Output string
	Args              []string
}

// FromBuild is main's release image build (origin/main infra/docker/Dockerfile), run from the root.
func FromBuild(root string) Build {
	return Build{Root: root, Output: "platform/app/dist/server/server.cjs", Args: []string{"pnpm", "--filter", "@langwatch/web...", "run", "build"}}
}

// HeadBuild is the release image's build; the api serves the UI bundle it writes.
func HeadBuild(root string) Build {
	return Build{Root: root, Output: "apps/ui/dist/client/index.html", Args: []string{"bash", "-c", headBuildScript}}
}

// Fresh answers whether the last build was of commit and its output is still there.
func (build Build) Fresh(commit string) bool {
	stamp, err := os.ReadFile(filepath.Join(build.Root, BuildStamp)) // #nosec G304 -- the harness's own stamp.
	_, outputErr := os.Stat(filepath.Join(build.Root, build.Output))
	return commit != "" && err == nil && outputErr == nil && strings.TrimSpace(string(stamp)) == commit
}

// Ensure builds unless Fresh, with no store or secret in its environment, then stamps HEAD.
func (build Build) Ensure(ctx context.Context, log string) error {
	out, _ := exec.CommandContext(ctx, "git", "-C", build.Root, "rev-parse", "HEAD").Output() // #nosec G204 -- fixed argv.
	commit := strings.TrimSpace(string(out))
	if build.Fresh(commit) {
		return nil
	}
	// No nx daemon: it outlives the build as an orphan holding half a gigabyte.
	env := map[string]string{"NODE_OPTIONS": "--max-old-space-size=4096", "NX_DAEMON": "false"}
	for _, key := range processKeys {
		if value, ok := os.LookupEnv(key); ok {
			env[key] = value
		}
	}
	command := exec.CommandContext(ctx, build.Args[0], build.Args[1:]...) // #nosec G204 -- argv fixed by the harness.
	command.Dir, command.Env = filepath.Join(build.Root, build.Dir), Env(env)
	output, err := command.CombinedOutput()
	_ = os.WriteFile(log, output, 0o600)
	if err != nil {
		return fmt.Errorf("build %s: %w: %s", build.Root, err, tail(output))
	}
	if commit == "" {
		return nil
	}
	return os.WriteFile(filepath.Join(build.Root, BuildStamp), []byte(commit+"\n"), 0o600)
}
