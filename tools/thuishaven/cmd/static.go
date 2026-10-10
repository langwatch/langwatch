package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// runStatic is the developer-tool lanes' server: a built bundle served from
// disk on loopback, so a tool such as the design system's Storybook never runs
// a dev server under haven. A missing bundle answers with the restart that
// builds it.
func runStatic(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.args) != 3 {
		return fmt.Errorf("haven static requires <lane> <dir> <port>")
	}
	lane, dir := inv.args[0], inv.args[1]
	port, err := strconv.Atoi(inv.args[2])
	if err != nil || port <= 0 {
		return fmt.Errorf("haven static: %q is not a port", inv.args[2])
	}
	srv := &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", port),
		Handler:           webconsole.New(os.DirFS(dir), "haven restart "+lane),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	fmt.Printf("%s: serving the built bundle in %s on 127.0.0.1:%d\n", lane, dir, port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
