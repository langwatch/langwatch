// Package upgradelab is the upgrade harness (plan-upgrade-snapshots, ruling D3). Today it holds
// the snapshot format: capture, restore, fingerprint and verify.
package upgradelab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
	"github.com/langwatch/langwatch/tools/upgradelab/snapshot"
)

// Exit codes: 0 done, 1 the stores differ from the snapshot, 2 usage, refusal or operational error.
const (
	exitOK = iota
	exitDifferences
	exitError
)

const usage = `upgradelab: upgrade snapshots (the upgrade harness lands here next)

  upgradelab snapshot capture     -out DIR -meta FILE [stores] [-allow-file FILE] [-forbid-env NAME]...
  upgradelab snapshot restore     -from DIR [stores]   only empty databases named upgradelab_<name>, buckets upgradelab-<name>
  upgradelab snapshot fingerprint [stores]             JSON on stdout
  upgradelab snapshot verify      -from DIR [stores]   exit 1 when the stores differ; no stores: checksums only
  upgradelab generate --shape S --release R [--volume S] [--seed N] [--anchor YYYY-MM-DD] [-out DIR -image IMAGE -commit SHA]
                                  prints the plan; with -out, runs it and captures a snapshot

stores: -postgres URL   -clickhouse TARGET=URL (repeatable; TARGET is shared or private-<label>)   -redis URL   -objects URL
        -objects http(s)://host[:port]/<bucket>[?region=R&addressing=path|virtual]; credentials from AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
`

type stringSlice []string

func (values *stringSlice) String() string { return strings.Join(*values, ",") }

func (values *stringSlice) Set(value string) error {
	*values = append(*values, value)
	return nil
}

// Run is the CLI; cmd/upgradelab/main.go calls it.
func Run(args []string, stdout, stderr io.Writer) int {
	if slices.ContainsFunc(args[:min(len(args), 2)], isHelp) {
		fmt.Fprint(stdout, usage)
		return exitOK
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(args) > 0 && args[0] == "generate" {
		if err := generate.Command(ctx, args[1:], stdout); err != nil {
			fmt.Fprintf(stderr, "upgradelab generate: %v\n", err)
			return exitError
		}
		return exitOK
	}
	if len(args) < 2 || args[0] != "snapshot" {
		fmt.Fprint(stderr, usage)
		return exitError
	}
	call := &invocation{verb: args[1], stdout: stdout}
	code, err := call.run(ctx, args[2:])
	if err != nil {
		fmt.Fprintf(stderr, "upgradelab snapshot %s: %v\n", args[1], err)
	}
	return code
}

func isHelp(arg string) bool { return arg == "-h" || arg == "--help" || arg == "help" }

type snapshotFlags struct {
	out, from, meta, allowFile, postgres, redis, objects string
	clickhouse, forbidEnv                                stringSlice
}

// invocation is one snapshot verb, its parsed flags and stores, and where its output goes.
type invocation struct {
	verb    string
	options snapshotFlags
	stores  snapshot.Stores
	stdout  io.Writer
}

func (call *invocation) run(ctx context.Context, args []string) (int, error) {
	if err := call.parse(args); errors.Is(err, flag.ErrHelp) {
		return exitOK, nil
	} else if err != nil {
		return exitError, err
	}
	switch call.verb {
	case "capture":
		return capture(ctx, call.options, call.stores)
	case "restore":
		_, err := snapshot.Restore(ctx, snapshot.RestoreInput{Dir: call.options.from, Stores: call.stores})
		return codeOf(err), err
	case "fingerprint":
		return call.fingerprint(ctx)
	case "verify":
		return call.verify(ctx)
	}
	return exitError, fmt.Errorf("unknown verb %q\n%s", call.verb, usage)
}

func (call *invocation) parse(args []string) error {
	options := &call.options
	flags := flag.NewFlagSet("snapshot "+call.verb, flag.ContinueOnError)
	flags.StringVar(&options.out, "out", "", "capture: the empty directory to write")
	flags.StringVar(&options.from, "from", "", "restore, verify: the snapshot directory")
	flags.StringVar(&options.meta, "meta", "", "capture: JSON with the producer's manifest fields")
	flags.StringVar(&options.allowFile, "allow-file", "", "capture: the shape's exact test values, one per line")
	flags.Var(&options.forbidEnv, "forbid-env", "capture: a secret-named variable whose value must appear nowhere")
	flags.StringVar(&options.postgres, "postgres", "", "postgresql://user:password@host:port/database[?schema=name]")
	flags.Var(&options.clickhouse, "clickhouse", "TARGET=http://user:password@host:8123/database")
	flags.StringVar(&options.redis, "redis", "", "redis://host:port/index")
	flags.StringVar(&options.objects, "objects", "", "http(s)://host[:port]/<bucket>[?region=R&addressing=path|virtual]; keys from AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN")
	if err := flags.Parse(args); err != nil {
		return err
	}
	stores, err := options.stores()
	call.stores = stores
	return err
}

func (call *invocation) fingerprint(ctx context.Context) (int, error) {
	fingerprint, err := snapshot.TakeFingerprint(ctx, call.stores)
	if err != nil {
		return exitError, err
	}
	encoder := json.NewEncoder(call.stdout)
	encoder.SetIndent("", "  ")
	return codeOf(encoder.Encode(fingerprint)), nil
}

func codeOf(err error) int {
	if err != nil {
		return exitError
	}
	return exitOK
}

func (options snapshotFlags) stores() (snapshot.Stores, error) {
	var stores snapshot.Stores
	var err error
	if stores.ClickHouse, err = clickHouseStores(options.clickhouse); err != nil {
		return stores, err
	}
	if options.postgres != "" {
		if stores.Postgres, err = snapshot.NewPostgresCLI(options.postgres); err != nil {
			return stores, err
		}
	}
	if options.redis != "" {
		if stores.Redis, err = snapshot.NewRedisRESP(options.redis); err != nil {
			return stores, err
		}
	}
	if options.objects != "" {
		store, err := snapshot.NewS3(options.objects, awsCredentials())
		if err != nil {
			return stores, err
		}
		stores.Objects = store
	}
	return stores, nil
}

// awsCredentials reads the standard AWS names; the values are never printed.
func awsCredentials() snapshot.Credentials {
	return snapshot.Credentials{AccessKeyID: os.Getenv("AWS_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("AWS_SECRET_ACCESS_KEY"), SessionToken: os.Getenv("AWS_SESSION_TOKEN")}
}

func clickHouseStores(pairs []string) (map[string]snapshot.ClickHouse, error) {
	stores := map[string]snapshot.ClickHouse{}
	for _, pair := range pairs {
		target, raw, ok := strings.Cut(pair, "=")
		if !ok || (target != "shared" && !strings.HasPrefix(target, "private-")) {
			return nil, errors.New("-clickhouse wants shared=URL or private-<label>=URL")
		}
		clickhouse, err := snapshot.NewClickHouseHTTP(raw)
		if err != nil {
			return nil, err
		}
		stores[target] = clickhouse
	}
	return stores, nil
}

func capture(ctx context.Context, options snapshotFlags, stores snapshot.Stores) (int, error) {
	if options.out == "" || options.meta == "" {
		return exitError, errors.New("capture needs -out and -meta")
	}
	var meta snapshot.Manifest
	data, err := os.ReadFile(options.meta)
	if err != nil {
		return exitError, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&meta); err != nil {
		return exitError, fmt.Errorf("-meta: %w", err)
	}
	scrubber := snapshot.Scrubber{Forbidden: map[string]string{}}
	for _, name := range options.forbidEnv {
		scrubber.Forbidden[name] = os.Getenv(name)
	}
	if options.allowFile != "" {
		allowed, err := os.ReadFile(options.allowFile)
		if err != nil {
			return exitError, err
		}
		scrubber.Allow = strings.Fields(string(allowed))
	}
	_, err = snapshot.Capture(ctx, snapshot.CaptureInput{Dir: options.out, Stores: stores, Meta: meta, Scrubber: scrubber})
	return codeOf(err), err
}

func (call *invocation) verify(ctx context.Context) (int, error) {
	dir, stores := call.options.from, call.stores
	if stores.Postgres == nil && len(stores.ClickHouse) == 0 && stores.Redis == nil && stores.Objects == nil {
		if _, err := snapshot.ReadManifestFile(dir); err != nil {
			return exitError, err
		}
		err := snapshot.VerifyChecksums(dir)
		return codeOf(err), err
	}
	diffs, err := snapshot.Verify(ctx, dir, stores)
	if err != nil {
		return exitError, err
	}
	for _, diff := range diffs {
		fmt.Fprintln(call.stdout, diff)
	}
	if len(diffs) > 0 {
		return exitDifferences, snapshot.ErrDifferences
	}
	return exitOK, nil
}
