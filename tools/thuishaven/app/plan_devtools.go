package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// storybookDir is the design system's `storybook build` output, relative to the checkout.
const storybookDir = "packages/design-system/storybook-static"

// storybookBuildShell builds the Storybook when its output is missing or older
// than a file it is built from, so an unchanged checkout starts serving at once.
// shortcut: mtime against index.html, misses a dependency change outside the
// listed paths; `rm -rf packages/design-system/storybook-static` forces a build.
const storybookBuildShell = "if ! test -f " + storybookDir + "/index.html || " +
	"test -n \"$(find packages/design-system/src packages/design-system/stories packages/design-system/.storybook " +
	"packages/design-system/package.json apps/ui/public pnpm-lock.yaml -newer " + storybookDir + "/index.html -print 2>/dev/null | head -1)\"; " +
	"then " + nxCacheEnv + "pnpm --silent exec nx run @langwatch/design-system:build:storybook --outputStyle=static; fi"

// designSystemChild is the design-system lane: the Storybook built to static
// files and served by this haven binary, never `storybook dev`.
func (p *childPlan) designSystemChild() Child {
	port := p.port(domain.DesignSystemService)
	serve := fmt.Sprintf("exec %s static %s %s %d", shQuote(p.o.havenExecutable()),
		domain.DesignSystemService, shQuote(filepath.Join(p.repoDir, storybookDir)), port)
	return Child{
		Name: domain.DesignSystemService, Dir: p.repoDir, Color: palette[6],
		LogPath: p.logPath(domain.DesignSystemService),
		Shell:   storybookBuildShell + " || echo 'the Storybook did not build; its page names the fix'; " + serve,
		Env:     append(append([]string{}, p.base...), domain.LaneEnv(domain.DesignSystemService)),
	}
}

// mailRoomDir is the mail studio's `build:studio` output: the studio with every
// fixture rendered at build time, through the call the product sends with.
const mailRoomDir = "packages/mail/preview/dist"

// mailRoomBuildShell rebuilds the studio when its output is missing or older
// than a template, fixture or studio file. It takes seconds.
const mailRoomBuildShell = "if ! test -f " + mailRoomDir + "/index.html || " +
	"test -n \"$(find packages/mail/src packages/mail/preview -path " + mailRoomDir + " -prune -o -type f " +
	"-newer " + mailRoomDir + "/index.html -print 2>/dev/null | head -1)\"; " +
	"then " + nxCacheEnv + "pnpm --silent exec nx run @langwatch/mail:build:studio --outputStyle=static; fi"

// mailRoomChild is the mail-room lane: the studio pre-rendered to static files
// and served by this haven binary, never a Vite dev server. Props are read-only.
func (p *childPlan) mailRoomChild() Child {
	port := p.port(domain.MailRoomService)
	serve := fmt.Sprintf("exec %s static %s %s %d", shQuote(p.o.havenExecutable()),
		domain.MailRoomService, shQuote(filepath.Join(p.repoDir, mailRoomDir)), port)
	return Child{
		Name: domain.MailRoomService, Dir: p.repoDir, Color: palette[9],
		LogPath: p.logPath(domain.MailRoomService),
		Shell:   mailRoomBuildShell + " || echo 'the mail studio did not build; its page names the fix'; " + serve,
		Env:     append(append([]string{}, p.base...), domain.LaneEnv(domain.MailRoomService)),
	}
}

// DocsPackage is the public docs site, built to static files and served by haven.
const DocsPackage = "@langwatch/docs-site"

// DocsBasePath is where haven mounts the docs: app.<slug>.langwatch.localhost/docs.
// Production stays at the root of docs.langwatch.ai; only haven's build takes it.
const DocsBasePath = "/docs"

// docsOutDir is haven's docs build, beside the production dist/ and ignored with
// node_modules, so a CI-shaped `pnpm build` never collides with it.
const docsOutDir = "apps/docs/node_modules/.cache/haven-docs"

// docsBuildShell checks the live build against the sources by content
// (build-status.ts: 0 current, 3 stale) and only then builds under DocsBasePath
// into a staging directory and swaps it in, so the mount never serves a
// half-written tree. Unchanged pages come from the build's render cache.
func docsBuildShell(repoDir string) string {
	d := shQuote(filepath.Join(repoDir, docsOutDir))
	return "d=" + d + "; n=$d.next.$$; o=$d.old.$$; " +
		"node apps/docs/src/site/build-status.ts --out-dir \"$d\" --base-path " + DocsBasePath + " && exit 0; " +
		"rm -rf \"$n\"; pnpm --silent --filter " + DocsPackage + " build --out-dir \"$n\" --base-path " + DocsBasePath +
		" && { ! test -d \"$d\" || mv \"$d\" \"$o\"; } && mv \"$n\" \"$d\" && rm -rf \"$o\""
}

// docsMountShell serves the docs natively under DocsBasePath on port at once and
// builds beside it, so the app behind the mount never waits on a docs build. With
// app set (a stack) every other path on the app hostname goes to the app's own
// listener; alone the root sends readers to the docs. Until the first build
// lands the mount shows a building page; a failed build keeps the last good tree.
func (o *Orchestrator) docsMountShell(repoDir string, port int, app *docsApp) string {
	serve := fmt.Sprintf("exec %s docs-mount %s %d %s", shQuote(o.havenExecutable()),
		shQuote(filepath.Join(repoDir, docsOutDir)), port, DocsBasePath)
	if app != nil {
		serve += fmt.Sprintf(" http://127.0.0.1:%d %s", app.port, shQuote(app.host))
	}
	return "{ (" + docsBuildShell(repoDir) + ") || echo 'the docs did not build; serving the last good build'; } & " + serve
}

// docsApp is the app a stack's docs mount hands every non-docs path to.
type docsApp struct {
	port int
	host string
}

// docsChild is the docs lane of a stack: built and mounted at /docs on the app
// hostname, which routes to this lane (see provision); docs.<slug> serves it too.
func (p *childPlan) docsChild() Child {
	port := p.port(domain.DocsService)
	app := &docsApp{port: p.port("app"), host: p.o.cfg.Naming.Hostname("app", p.st.Slug)}
	return Child{
		Name: domain.DocsService, Dir: p.repoDir, Color: palette[4],
		LogPath: p.logPath(domain.DocsService),
		Shell:   p.o.docsMountShell(p.repoDir, port, app),
		Env:     append(append([]string{}, p.base...), domain.LaneEnv(domain.DocsService)),
	}
}

// havenExecutable is this haven binary, the first word of the simulator command.
func (o *Orchestrator) havenExecutable() string {
	if len(o.cfg.SimulatorArgv) == 0 {
		return "haven"
	}
	return o.cfg.SimulatorArgv[0]
}
