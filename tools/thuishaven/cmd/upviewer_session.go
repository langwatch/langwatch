package cmd

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// The session tab: haven's own view of the stack it is running. It is the one
// tab whose datasource is haven itself rather than a file or the observability
// stack, which is why it is rendered here, beside the action surface it drives,
// rather than in the viewer package with the other tabs.

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
	switch {
	case svc.Fallback:
		tag = " \x1b[2m(shared)\x1b[0m"
	case svc.Shared:
		tag = " \x1b[2m(machine-wide)\x1b[0m"
	case !svc.Restartable:
		tag = " \x1b[2m(managed)\x1b[0m"
	}
	dest := svc.URL
	if dest == "" {
		dest = svc.Detail
	}
	if dest == "" && svc.Port != 0 {
		dest = fmt.Sprintf(":%d", svc.Port)
	}
	row := fmt.Sprintf(" %s  %-13s %s\x1b[2m%s\x1b[0m", dot, name, dest, tag)
	if m.onDashboard() && i == m.cursor {
		return selectedLine("›"+row, m.width)
	}
	return " " + row
}
