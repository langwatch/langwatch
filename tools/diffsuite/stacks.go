package diffsuite

import (
	"cmp"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
	"github.com/langwatch/langwatch/tools/visualdiff"
)

const bootTimeout = 20 * time.Minute

// haven is what the suite asks of haven and of visualdiff's main boot; tests replace it.
var haven = struct {
	read    func(ctx context.Context, slug string) (diffkit.SharedStack, error)
	up      func(ctx context.Context, root, slug string, deltas []string, env havenrun.EnvOptions, stderr io.Writer) error
	destroy func(root, slug string, stderr io.Writer)
	upMain  func(ctx context.Context, request visualdiff.MainStackRequest) (string, func(), error)
}{read: diffkit.ReadSharedStack, up: havenUp, destroy: havenDestroy, upMain: visualdiff.BootMainStack}

// stackFlags choose the suite's stacks: the branch one named or started from this
// checkout, and a main one named, started from the pinned main, or none.
type stackFlags struct {
	stack, mainStack string
	up, main         bool
	// langevals adds +langevals to the branch stack -up starts.
	langevals bool
	// deployment is saas (the default) or self-hosted.
	deployment string
}

const (
	saas       = "saas"
	selfHosted = "self-hosted"
	// selfHostedSlug is the running self-hosted stack -deployment self-hosted adopts by default.
	selfHostedSlug = "visualdiff-selfhosted"
)

// selfHostedEnv starts a stack with IS_SAAS=false. haven has no per-slug overlay, but the
// process environment beats the root .env: node --env-file and vite's dotenv never override it.
var selfHostedEnv = havenrun.EnvOptions{ExtraManagedKeys: []string{"IS_SAAS"}, Extra: []string{"IS_SAAS=false"}}

// stacks are the suite's stacks and the stops of the ones it started, run last-first.
type stacks struct {
	branch, main diffkit.SharedStack
	stops        []func()
}

func (stacks *stacks) stop() {
	for index := len(stacks.stops) - 1; index >= 0; index-- {
		stacks.stops[index]()
	}
}

// env hands the stacks to a tool (diffkit.SuiteEnv): the branch always, main when there is one.
func (stacks *stacks) env() []string {
	env := diffkit.SuiteEnv(diffkit.SuiteBranch, stacks.branch)
	if stacks.main.AppURL != "" {
		env = append(env, diffkit.SuiteEnv(diffkit.SuiteMain, stacks.main)...)
	}
	return env
}

// resolve adopts or starts each stack; a stack it started is stopped by stop, even
// when resolve fails part-way.
func (stacks *stacks) resolve(ctx context.Context, flags stackFlags, root, out string, stderr io.Writer) error {
	if flags.up && flags.stack != "" {
		return fmt.Errorf("-stack names a running stack and -up starts one: pass one")
	}
	if flags.langevals && !flags.up {
		return fmt.Errorf("-langevals applies to the stack -up starts; an adopted stack keeps its own selection")
	}
	if flags.main && flags.mainStack != "" {
		return fmt.Errorf("-main-stack names a running main and -main starts one: pass one")
	}
	if flags.deployment != saas && flags.deployment != selfHosted {
		return fmt.Errorf("-deployment is saas or self-hosted, not %q", flags.deployment)
	}
	isSelfHosted := flags.deployment == selfHosted
	if isSelfHosted && flags.main {
		return fmt.Errorf("-main boots pinned main as SaaS; under -deployment self-hosted name a self-hosted main with -main-stack")
	}
	stamp := time.Now().Format("0102-150405")
	var err error
	switch {
	case flags.up:
		slug, env := havenrun.Slug("diffsuite", stamp, "branch"), havenrun.EnvOptions{}
		if isSelfHosted {
			slug, env = havenrun.Slug("diffsuite", stamp, "selfhosted"), selfHostedEnv
		}
		stacks.stops = append(stacks.stops, func() { haven.destroy(root, slug, stderr) })
		fmt.Fprintf(stderr, "diffsuite: starting the %s branch stack %s from %s\n", flags.deployment, slug, root)
		var deltas []string
		if flags.langevals {
			deltas = append(deltas, "+langevals")
		}
		if err := haven.up(ctx, root, slug, deltas, env, stderr); err != nil {
			return err
		}
		stacks.branch, err = haven.read(ctx, slug)
	case isSelfHosted:
		slug := cmp.Or(flags.stack, selfHostedSlug)
		if stacks.branch, err = haven.read(ctx, slug); err != nil {
			err = fmt.Errorf("%w (start it with: IS_SAAS=false LANGWATCH_SLUG=%s haven up --agent --detach, or pass -up)", err, slug)
		}
	default:
		stacks.branch, err = haven.read(ctx, cmp.Or(flags.stack, diffkit.CheckSlug))
	}
	if err != nil {
		return fmt.Errorf("branch stack: %w", err)
	}
	switch {
	case flags.main:
		slug := havenrun.Slug("diffsuite", stamp, "main")
		fmt.Fprintf(stderr, "diffsuite: starting pinned main as %s\n", slug)
		_, stop, err := haven.upMain(ctx, visualdiff.MainStackRequest{Root: root, RunDir: filepath.Join(out, "main"), Slug: slug, Stderr: stderr})
		stacks.stops = append(stacks.stops, stop)
		if err == nil {
			stacks.main, err = haven.read(ctx, slug)
		}
		if err != nil {
			return fmt.Errorf("main stack: %w", err)
		}
	case flags.mainStack != "":
		if stacks.main, err = haven.read(ctx, flags.mainStack); err != nil {
			return fmt.Errorf("main stack: %w", err)
		}
	}
	if isSelfHosted {
		for _, stack := range []diffkit.SharedStack{stacks.branch, stacks.main} {
			if stack.AppURL != "" && answersAsSaaS(stack.AppURL) {
				return fmt.Errorf("-deployment self-hosted: %s hides the instance-admin routes (GET /api/organizations is 404): it runs as SaaS or has no LANGWATCH_INSTANCE_ADMIN_API_KEY; start it with IS_SAAS=false", stack.Slug)
			}
		}
	}
	return nil
}

// answersAsSaaS is true when the instance-admin door answers 404: SaaS does before reading
// any credential, as does a stack with no admin key; a keyed self-hosted one answers 401.
func answersAsSaaS(apiOrigin string) bool {
	response, err := (&http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}}).Get(apiOrigin + "/api/organizations")
	if err != nil {
		return false
	}
	response.Body.Close()
	return response.StatusCode == http.StatusNotFound
}

func havenUp(ctx context.Context, root, slug string, deltas []string, env havenrun.EnvOptions, stderr io.Writer) error {
	command := exec.CommandContext(ctx, havenrun.Command, havenrun.UpArgs(deltas...)...) // #nosec G204 -- fixed haven args.
	command.Dir, command.Env = root, havenrun.Env(os.Environ(), slug, env)
	command.Stdout, command.Stderr = stderr, stderr
	return command.Run()
}

func havenDestroy(root, slug string, stderr io.Writer) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	fmt.Fprintf(stderr, "diffsuite: haven destroy %s\n", slug)
	command := exec.CommandContext(ctx, havenrun.Command, havenrun.DestroyArgs(slug)...) // #nosec G204 -- fixed haven args.
	command.Dir, command.Env = root, havenrun.Env(os.Environ(), slug, havenrun.EnvOptions{})
	command.Stdout, command.Stderr = stderr, stderr
	if err := command.Run(); err != nil {
		fmt.Fprintf(stderr, "diffsuite: haven destroy %s: %v\n", slug, err)
	}
}
