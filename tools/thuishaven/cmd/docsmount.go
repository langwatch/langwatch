package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/docsmount"
)

// runDocsMount is the docs lane's server: the docs built with --base-path served
// from disk under that prefix. Given the app's own listener and hostname, every
// other path on the app hostname goes to the app, so <app>/docs is a real address.
func runDocsMount(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.args) != 3 && len(inv.args) != 5 {
		return fmt.Errorf("haven docs-mount requires <dir> <port> <base-path> [<app-url> <app-host>]")
	}
	opts, port, err := docsMountOptions(inv.args)
	if err != nil {
		return err
	}
	handler, err := docsmount.New(opts)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              fmt.Sprintf("127.0.0.1:%d", port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	fmt.Printf("docs: serving %s under %s/ on 127.0.0.1:%d\n", opts.Dir, opts.BasePath, port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// docsMountOptions reads <dir> <port> <base-path> [<app-url> <app-host>].
func docsMountOptions(args []string) (docsmount.Options, int, error) {
	opts := docsmount.Options{Dir: args[0], BasePath: args[2]}
	port, err := strconv.Atoi(args[1])
	if err != nil || port <= 0 {
		return opts, 0, fmt.Errorf("haven docs-mount: %q is not a port", args[1])
	}
	if len(args) == 5 {
		upstream, err := url.Parse(args[3])
		if err != nil || upstream.Host == "" {
			return opts, 0, fmt.Errorf("haven docs-mount: %q is not the app's URL", args[3])
		}
		opts.Upstream, opts.AppHost = upstream, args[4]
	}
	return opts, port, nil
}
