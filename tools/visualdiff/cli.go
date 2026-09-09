package visualdiff

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"
)

const usage = `visualdiff — render every route and every flow on two refs and diff them

  visualdiff run [-base REF] [-candidate REF] [-routes-only] [-flows a,b]
                 [-viewport 1440x900] [-config visualdiff.yaml] [-root DIR]
                 [-base-port N] [-run-dir DIR] [-boot-timeout DUR]
                 [-dry-run] [-keep] [-agent] [-no-haven]

Each ref boots as a haven stack under its own run-scoped slug wherever haven
is installed, so a run never reaches the datastores your own stack uses.
-no-haven boots the old way instead, on -base-port and its ten-above stride,
sharing your own Postgres, ClickHouse and Redis.

Exit status: 0 no findings, 1 findings, 2 the run could not be completed.
`

// Run is the visualdiff CLI. It returns the process exit code.
func Run(ctx context.Context, args []string, streams Streams) int {
	if len(args) == 0 {
		fmt.Fprint(streams.Err, usage)
		return ExitOperational
	}
	switch args[0] {
	case "run":
		return runCommand(ctx, args[1:], streams)
	case "-h", "--help", "help":
		fmt.Fprint(streams.Out, usage)
		return ExitClean
	default:
		fmt.Fprintf(streams.Err, "visualdiff: unknown command %q\n\n%s", args[0], usage)
		return ExitOperational
	}
}

// runFlags is one parsed `visualdiff run` command line.
type runFlags struct {
	options Options
	config  *Config
}

func runCommand(ctx context.Context, args []string, streams Streams) int {
	parsed, err := parseRunFlags(args, streams.Err)
	if err != nil {
		if !errors.Is(err, errFlagsReported) {
			fmt.Fprintln(streams.Err, "visualdiff:", err)
		}
		return ExitOperational
	}
	result, err := Execute(ctx, Request{Options: parsed.options, Config: parsed.config}, streams)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
	}
	return ExitCode(result, err)
}

// errFlagsReported says the flag package already printed what was wrong, so
// the caller exits without saying it twice.
var errFlagsReported = errors.New("flags rejected")

// parseRunFlags reads the command line and the configuration.
func parseRunFlags(args []string, stderr io.Writer) (*runFlags, error) {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(stderr)
	baseRef := flags.String("base", "origin/main", "ref to compare against")
	candidateRef := flags.String("candidate", "HEAD", "ref under test")
	root := flags.String("root", ".", "repository root")
	configPath := flags.String("config", "", "configuration file (default <root>/"+ConfigFile+")")
	viewport := flags.String("viewport", "1440x900", "browser viewport, WIDTHxHEIGHT")
	routesOnly := flags.Bool("routes-only", false, "capture the route list and skip the flows")
	flowList := flags.String("flows", "", "comma-separated flow ids to run (default: all)")
	basePort := flags.Int("base-port", DefaultBasePort, "first port of the base stack")
	runDir := flags.String("run-dir", "", "directory for worktrees, logs, screenshots and the report")
	bootTimeout := flags.Duration("boot-timeout", 20*time.Minute, "how long a stack gets to answer")
	dryRun := flags.Bool("dry-run", false, "print the plan and start nothing")
	keep := flags.Bool("keep", false, "leave both stacks and both worktrees up after the run")
	agent := flags.Bool("agent", false, "plain, token-free output for an agent")
	noHaven := flags.Bool("no-haven", false, "do not boot the stacks as haven stacks; use -base-port and share this machine's own databases instead")
	projectKey := flags.String("project-key", DefaultProjectKey, "project key the fixtures are posted with")
	slug := flags.String("slug", "", "project slug the routes are rendered for")
	email := flags.String("email", "", "email the runner signs in with")
	password := flags.String("password", "", "password the runner signs in with")
	if err := flags.Parse(args); err != nil {
		return nil, errFlagsReported
	}

	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		return nil, err
	}
	config, parsedViewport, err := loadRunConfig(flags, runConfigInputs{root: absoluteRoot, configPath: *configPath, flowList: *flowList, viewport: *viewport})
	if err != nil {
		return nil, err
	}

	options := Options{
		Root: absoluteRoot, BaseRef: *baseRef, CandidateRef: *candidateRef, RunDir: *runDir,
		BasePort: *basePort, Viewport: parsedViewport, RoutesOnly: *routesOnly,
		Agent: *agent, DryRun: *dryRun, Keep: *keep,
		BootTimeout: *bootTimeout,
		UseHaven:    havenSelected(havenOnPath(), *noHaven),
		Identity: SeedIdentity{
			ProjectKey: *projectKey, Slug: *slug, Email: *email, Password: *password,
		},
	}
	return &runFlags{options: options, config: config}, nil
}

// runConfigInputs carries loadRunConfig's raw flag values, grouped so the
// function itself stays within this repository's argument-count limit.
type runConfigInputs struct {
	root       string
	configPath string
	flowList   string
	viewport   string
}

// loadRunConfig parses the -viewport flag, resolves the configuration file
// (default <root>/visualdiff.yaml), narrows it to the requested flows, and
// settles the viewport: the command line wins when given, the configured one
// otherwise.
func loadRunConfig(flags *flag.FlagSet, inputs runConfigInputs) (*Config, Viewport, error) {
	parsedViewport, err := ParseViewport(inputs.viewport)
	if err != nil {
		return nil, Viewport{}, err
	}
	path := inputs.configPath
	if path == "" {
		path = filepath.Join(inputs.root, ConfigFile)
	}
	config, err := LoadConfig(path)
	if err != nil {
		return nil, Viewport{}, err
	}
	config, err = config.SelectFlows(splitList(inputs.flowList))
	if err != nil {
		return nil, Viewport{}, err
	}
	if !isFlagSet(flags, "viewport") {
		parsedViewport = configuredViewport(config, parsedViewport)
	}
	return config, parsedViewport, nil
}

// configuredViewport takes the configured viewport when there is one, and the
// command line's otherwise.
func configuredViewport(config *Config, fallback Viewport) Viewport {
	if config.Viewport == "" {
		return fallback
	}
	parsed, err := ParseViewport(config.Viewport)
	if err != nil {
		return fallback
	}
	return parsed
}

// isFlagSet reports whether the operator gave a flag, so a configured
// viewport never overrides one asked for on the command line.
func isFlagSet(flags *flag.FlagSet, name string) bool {
	given := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == name {
			given = true
		}
	})
	return given
}

func splitList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
