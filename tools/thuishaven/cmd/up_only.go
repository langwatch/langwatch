package cmd

import (
	"context"
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runUpOnly is `haven up --only <lane>`: one lane alone, with no stack, no
// databases and no selection change. Only the docs site runs alone. With -d it
// backgrounds like `haven up -d`; `haven down` stops it either way.
func runUpOnly(ctx context.Context, d deps, inv invocation) error {
	lane := inv.value("--only")
	if lane != domain.DocsService {
		return usageErr("--only %s: only the docs site runs alone (haven up --only docs)", lane)
	}
	if len(inv.args) > 0 || inv.has("--watch") || inv.has("--hmr") || inv.value("--mode") != "" {
		return usageErr("haven up --only docs takes no +svc/-svc, --watch, --hmr or --mode")
	}
	if err := d.orch.DocsSoloRefusal(d.params); err != nil {
		return err
	}
	if !inv.has("--detach") {
		return d.orch.RunDocsSolo(ctx, d.params)
	}
	st, err := startDetachedUp(d, inv.raw)
	if err != nil {
		return err
	}
	fmt.Printf("docs for %q starting detached, alone (pid %d)\n", st.slug, st.pid)
	fmt.Printf("  url:    docs.%s.langwatch.localhost (haven status)\n", st.slug)
	fmt.Printf("  logs:   haven logs docs -f\n")
	fmt.Printf("  stop:   haven down\n")
	return nil
}
