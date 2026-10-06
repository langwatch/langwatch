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
	up      func(ctx context.Context, request upRequest) error
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

// stackRequest is what resolve needs: the flags, the checkout a stack starts
// from, the suite's output directory and where progress goes.
type stackRequest struct {
	flags  stackFlags
	root   string
	out    string
	stderr io.Writer
	stamp  string
}

// upRequest is one haven up: the checkout, the slug, the deltas and the env.
type upRequest struct {
	root   string
	slug   string
	deltas []string
	env    havenrun.EnvOptions
	stderr io.Writer
}

// resolve adopts or starts each stack; a stack it started is stopped by stop, even
// when resolve fails part-way.
func (stacks *stacks) resolve(ctx context.Context, request stackRequest) error {
	if err := request.flags.validate(); err != nil {
		return err
	}
	request.stamp = time.Now().Format("0102-150405")
	if err := stacks.resolveBranch(ctx, request); err != nil {
		return err
	}
	if err := stacks.resolveMain(ctx, request); err != nil {
		return fmt.Errorf("main stack: %w", err)
	}
	if request.flags.deployment == selfHosted {
		return stacks.requireSelfHosted()
	}
	return nil
}

func (flags stackFlags) validate() error {
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
	if flags.deployment == selfHosted && flags.main {
		return fmt.Errorf("-main boots pinned main as SaaS; under -deployment self-hosted name a self-hosted main with -main-stack")
	}
	return nil
}

// resolveBranch adopts or starts the branch stack. A failed haven up is
// returned as it is; a failed read is a "branch stack" error.
func (stacks *stacks) resolveBranch(ctx context.Context, request stackRequest) error {
	flags := request.flags
	var err error
	switch {
	case flags.up:
		if err := stacks.startBranch(ctx, request); err != nil {
			return err
		}
		stacks.branch, err = haven.read(ctx, havenrun.Slug("diffsuite", request.stamp, branchKind(flags)))
	case flags.deployment == selfHosted:
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
	return nil
}

// branchKind names the branch stack -up starts: "selfhosted" or "branch".
func branchKind(flags stackFlags) string {
	if flags.deployment == selfHosted {
		return "selfhosted"
	}
	return "branch"
}

// startBranch starts the branch stack -up asks for and registers its destroy.
func (stacks *stacks) startBranch(ctx context.Context, request stackRequest) error {
	flags, root, stderr := request.flags, request.root, request.stderr
	slug, env := havenrun.Slug("diffsuite", request.stamp, branchKind(flags)), havenrun.EnvOptions{}
	if flags.deployment == selfHosted {
		env = selfHostedEnv
	}
	stacks.stops = append(stacks.stops, func() { haven.destroy(root, slug, stderr) })
	fmt.Fprintf(stderr, "diffsuite: starting the %s branch stack %s from %s\n", flags.deployment, slug, root)
	var deltas []string
	if flags.langevals {
		deltas = append(deltas, "+langevals")
	}
	return haven.up(ctx, upRequest{root: root, slug: slug, deltas: deltas, env: env, stderr: stderr})
}

func (stacks *stacks) resolveMain(ctx context.Context, request stackRequest) error {
	var err error
	switch {
	case request.flags.main:
		slug := havenrun.Slug("diffsuite", request.stamp, "main")
		fmt.Fprintf(request.stderr, "diffsuite: starting pinned main as %s\n", slug)
		var stop func()
		_, stop, err = haven.upMain(ctx, visualdiff.MainStackRequest{Root: request.root, RunDir: filepath.Join(request.out, "main"), Slug: slug, Stderr: request.stderr})
		stacks.stops = append(stacks.stops, stop)
		if err == nil {
			stacks.main, err = haven.read(ctx, slug)
		}
	case request.flags.mainStack != "":
		stacks.main, err = haven.read(ctx, request.flags.mainStack)
	}
	return err
}

// requireSelfHosted refuses a stack that answers as SaaS under -deployment self-hosted.
func (stacks *stacks) requireSelfHosted() error {
	for _, stack := range []diffkit.SharedStack{stacks.branch, stacks.main} {
		if stack.AppURL != "" && answersAsSaaS(stack.AppURL) {
			return fmt.Errorf("-deployment self-hosted: %s hides the instance-admin routes (GET /api/organizations is 404): it runs as SaaS or has no LANGWATCH_INSTANCE_ADMIN_API_KEY; start it with IS_SAAS=false", stack.Slug)
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

func havenUp(ctx context.Context, request upRequest) error {
	command := exec.CommandContext(ctx, havenrun.Command, havenrun.UpArgs(request.deltas...)...) // #nosec G204 -- fixed haven args.
	command.Dir, command.Env = request.root, havenrun.Env(os.Environ(), request.slug, request.env)
	command.Stdout, command.Stderr = request.stderr, request.stderr
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
