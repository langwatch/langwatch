package cmd

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func init() {
	register(&Command{
		Name:      "dashboard",
		ShortHelp: "open your LangWatch dashboard in the browser",
		Run:       runDashboard,
	})
}

func runDashboard(_ context.Context, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login`")
	}
	url := strings.TrimRight(cfg.ControlPlaneURL, "/") + "/me"
	fmt.Printf("Opening %s\n", url)
	return openURL(url)
}

func openURL(url string) error {
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name = "open"
		args = []string{url}
	case "windows":
		name = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		name = "xdg-open"
		args = []string{url}
	}
	return exec.Command(name, args...).Start()
}
