package cmd

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os/exec"
	"runtime"
	"strings"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func init() {
	register(&Command{
		Name:      "dashboard",
		ShortHelp: "open your LangWatch dashboard in the browser (use --trace <id> to deep-link)",
		Run:       runDashboard,
	})
	register(&Command{
		Name:      "request-increase",
		ShortHelp: "open the budget-increase request page in the browser",
		Run:       runRequestIncrease,
	})
}

// runDashboard opens the user's /me page by default. With --trace <id>, it
// deep-links into that trace's view so a developer can jump from a CLI
// transcript to the matching request in the web UI without copy-paste.
//
// The trace deep-link is the Screen-5 → Screen-6 bridge from gateway.md
// — devs spend most of their time in the terminal, but when they want
// "wait, what did this cost / which model handled it" the answer lives
// in the dashboard.
func runDashboard(_ context.Context, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login`")
	}

	fs := flag.NewFlagSet("dashboard", flag.ContinueOnError)
	traceID := fs.String("trace", "", "deep-link to a specific trace ID")
	if err := fs.Parse(args); err != nil {
		return err
	}

	target := strings.TrimRight(cfg.ControlPlaneURL, "/") + "/me"
	if *traceID != "" {
		// /me/traces/<id> is the dashboard's per-trace deep-link route.
		// Falls back to /me if the trace can't be resolved server-side
		// (404 handled by the dashboard itself, not the CLI).
		target += "/traces/" + url.PathEscape(*traceID)
	}

	fmt.Printf("Opening %s\n", target)
	return openURL(target)
}

// runRequestIncrease implements the Screen-8 "Need urgent access?" tail —
// when a user hits their personal monthly budget, the CLI prints a
// branded box ending with `Run: langwatch request-increase`, and this
// command takes them to the request page.
//
// We don't construct the URL ourselves: when the gateway emits a 402
// budget_exceeded payload (per budget-exceeded.feature), the
// `request_increase_url` field is the canonical, signed URL with the
// user/limit/spent params already attached. The wrapper persists that
// URL in the config on the way through, and this command opens it.
//
// If the user runs `langwatch request-increase` proactively (no recent
// 402), we fall back to the dashboard's static request page at
// `<dashboard>/me/budget/request`.
func runRequestIncrease(_ context.Context, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login`")
	}

	target := cfg.LastRequestIncreaseURL
	if target == "" {
		target = strings.TrimRight(cfg.ControlPlaneURL, "/") + "/me/budget/request"
	}
	fmt.Printf("Opening %s\n", target)
	return openURL(target)
}

func openURL(rawURL string) error {
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name = "open"
		args = []string{rawURL}
	case "windows":
		name = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", rawURL}
	default:
		name = "xdg-open"
		args = []string{rawURL}
	}
	return exec.Command(name, args...).Start()
}
