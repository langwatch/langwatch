package cmd

import (
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The session tab: haven's own view of the stack it is running. It is the one
// tab whose datasource is haven itself rather than a file or the observability
// stack, which is why it is rendered here, beside the action surface it drives,
// rather than in the viewer package with the other seven.

// dashboardBody renders tab one: the ASCII art, the stack summary, the live
// service and server rows, and the action hint.
func (m *viewerModel) dashboardBody() string {
	var b strings.Builder
	b.WriteString(m.headerBlock())
	b.WriteString("\n")

	if !m.snap.Found {
		b.WriteString(" \x1b[2mthe stack is still provisioning; its services appear here as they register…\x1b[0m\n")
		return b.String()
	}

	b.WriteString(" " + m.stackLine() + "\n\n")

	b.WriteString(" \x1b[1mSERVICES\x1b[0m  \x1b[2m↑↓ move · enter opens its logs · r restart · a restart all\x1b[0m\n")
	for i, svc := range m.snap.Services {
		b.WriteString(m.serviceRow(i, svc) + "\n")
	}

	b.WriteString("\n \x1b[1mSHARED\x1b[0m\n")
	b.WriteString(" " + m.serversLine() + "\n")

	if m.toast != "" {
		b.WriteString("\n \x1b[7m " + m.toast + " \x1b[0m\n")
	}

	b.WriteString("\n " + m.footerHint() + "\n")
	return b.String()
}

// stackLine is the one-line summary: slug, branch, liveness, and the RAM the
// whole process group is costing this machine.
func (m *viewerModel) stackLine() string {
	live := "\x1b[31m● stale\x1b[0m"
	if m.snap.Live {
		live = "\x1b[32m● live\x1b[0m"
	}
	branch := m.snap.Branch
	if branch == "" {
		branch = "no branch"
	}
	ram := ""
	if m.snap.RSS > 0 {
		ram = "  \x1b[2m~" + domain.HumanBytes(int64(m.snap.RSS)) + " RAM\x1b[0m"
	}
	return fmt.Sprintf("\x1b[1m%s\x1b[0m  %s  \x1b[2m%s\x1b[0m%s", m.snap.Slug, live, branch, ram)
}

// serviceRow renders one service: a status dot, its name, and where it is
// reached - highlighted when the cursor sits on it, dimmed when it is a shared
// baseline's copy this worktree merely routes to.
func (m *viewerModel) serviceRow(i int, svc app.SessionServiceStatus) string {
	dot := "\x1b[2m○\x1b[0m"
	if svc.Up {
		dot = "\x1b[32m●\x1b[0m"
	}
	name := svc.Name
	tag := ""
	if svc.Fallback {
		tag = " \x1b[2m(shared)\x1b[0m"
	} else if !svc.Restartable {
		tag = " \x1b[2m(managed)\x1b[0m"
	}
	dest := svc.URL
	if dest == "" && svc.Port != 0 {
		dest = fmt.Sprintf(":%d", svc.Port)
	}
	row := fmt.Sprintf(" %s  %-9s %s\x1b[2m%s\x1b[0m", dot, name, dest, tag)
	if m.onDashboard() && i == m.cursor {
		return "\x1b[7m›" + row + "\x1b[0m"
	}
	return " " + row
}

// serversLine renders the shared machinery as compact dot+name pills on one
// line - the proxy, the daemon, and whichever database servers this stack uses.
func (m *viewerModel) serversLine() string {
	parts := make([]string, 0, len(m.snap.Servers))
	for _, s := range m.snap.Servers {
		dot := "\x1b[31m○\x1b[0m"
		if s.Up {
			dot = "\x1b[32m●\x1b[0m"
		}
		parts = append(parts, fmt.Sprintf("%s %s", dot, s.Name))
	}
	if len(parts) == 0 {
		return "\x1b[2mnone\x1b[0m"
	}
	return strings.Join(parts, "   ")
}

func (m *viewerModel) footerHint() string {
	quit := "q detaches (stack keeps running) · X stops it"
	if m.destroyOnQuit {
		quit = "\x1b[31mq quits and DESTROYS the sandbox\x1b[0m"
	}
	return "\x1b[2m→/tab logs · 1-9 jump · " + quit + "\x1b[0m"
}

// headerBlock is the wordmark and ASCII art at the top of tab one: a dockside
// crane stacking containers (the stack) in a safe local port.
func (m *viewerModel) headerBlock() string {
	yellow := func(s string) string { return "\x1b[33m" + s + "\x1b[0m" }
	dim := func(s string) string { return "\x1b[90m" + s + "\x1b[0m" }
	water := func(s string) string { return "\x1b[34m" + s + "\x1b[0m" }
	cellColors := []string{"96", "94", "92", "95"}
	cell := func(i int) string { return "\x1b[1;" + cellColors[i%len(cellColors)] + "m[##]\x1b[0m" }
	containers := func(base int) string {
		return dim(" |") + "  " + cell(base) + " " + cell(base+1) + " " + cell(base+2) + "  " + dim("|")
	}

	rows := []string{
		"  " + yellow(`     __`) + "        \x1b[1;96mh a v e n\x1b[0m",
		//nolint:misspell // the wordmark's own British spelling, printed on screen
		"  " + yellow(`    |  |___`) + "     \x1b[2ma safe harbour for your\x1b[0m",
		"  " + yellow(`    |  |   |___`) + " \x1b[2mlocal stack: every service\x1b[0m",
		"  " + yellow(`  __|__|___|___|__`) + " \x1b[2min one place\x1b[0m",
		"  " + containers(0),
		"  " + containers(1),
		"  " + dim(` |________________|`),
		"  " + water(`  ~~~~~~~~~~~~~~~~`),
	}
	return strings.Join(rows, "\n") + "\n"
}
