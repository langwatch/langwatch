package cmd

import (
	"context"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runUpOnly is `haven up --only <lane>`: one lane alone in the foreground, with
// no stack, no databases and no selection change. Only the docs site runs alone.
func runUpOnly(ctx context.Context, d deps, inv invocation) error {
	lane := inv.value("--only")
	if lane != domain.DocsService {
		return usageErr("--only %s: only the docs site runs alone (haven up --only docs)", lane)
	}
	if len(inv.args) > 0 || inv.has("--detach") || inv.has("--watch") || inv.has("--hmr") || inv.value("--mode") != "" {
		return usageErr("haven up --only docs takes no +svc/-svc, --detach, --watch, --hmr or --mode: it runs in the foreground until stopped (an agent runs it in the background)")
	}
	return d.orch.RunDocsSolo(ctx, d.params)
}
