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

// havenExecutable is this haven binary, the first word of the simulator command.
func (o *Orchestrator) havenExecutable() string {
	if len(o.cfg.SimulatorArgv) == 0 {
		return "haven"
	}
	return o.cfg.SimulatorArgv[0]
}
