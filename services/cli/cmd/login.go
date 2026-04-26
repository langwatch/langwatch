package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/cli/internal/auth"
	"github.com/langwatch/langwatch/services/cli/internal/config"
)

func init() {
	register(&Command{
		Name:      "login",
		ShortHelp: "sign in via your company SSO and provision a personal VK",
		Run:       runLogin,
	})
	register(&Command{
		Name:      "logout",
		ShortHelp: "clear local credentials",
		Run:       runLogout,
	})
	register(&Command{
		Name:      "whoami",
		ShortHelp: "print current identity, organization, and gateway URL",
		Run:       runWhoami,
	})
}

func runLogin(ctx context.Context, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	client := &auth.Client{BaseURL: cfg.ControlPlaneURL}

	dc, err := client.StartDeviceCode(ctx)
	if err != nil {
		return fmt.Errorf("start device flow: %w", err)
	}

	verifyURL := dc.VerificationURI
	if !strings.Contains(verifyURL, dc.UserCode) {
		// servers SHOULD return a verification_uri_complete that already
		// includes the code; if they don't, fall back to the bare URL +
		// instruct the user to type their code.
		verifyURL = strings.TrimRight(verifyURL, "/") + "?code=" + dc.UserCode
	}

	fmt.Printf("Opening browser to authenticate...\n")
	fmt.Printf("Verification URL: %s\n", verifyURL)
	fmt.Printf("If your browser does not open, paste the URL above and enter code: %s\n\n", dc.UserCode)
	_ = openBrowser(verifyURL)

	fmt.Printf("Waiting for you to log in")
	doneCh := make(chan struct{})
	go spinner(doneCh)

	result, err := client.PollUntilDone(ctx, dc)
	close(doneCh)
	fmt.Println()
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrDenied):
			return errors.New("authorization denied — you can retry `langwatch login`")
		case errors.Is(err, auth.ErrExpired):
			return errors.New("authorization request expired — run `langwatch login` again")
		case errors.Is(err, context.Canceled):
			return errors.New("login cancelled")
		default:
			return err
		}
	}

	cfg.AccessToken = result.AccessToken
	cfg.RefreshToken = result.RefreshToken
	cfg.ExpiresAt = time.Now().Unix() + int64(result.ExpiresIn)
	cfg.User = config.Identity{
		ID:    result.User.ID,
		Email: result.User.Email,
		Name:  result.User.Name,
	}
	cfg.Organization = config.Organization{
		ID:   result.Organization.ID,
		Slug: result.Organization.Slug,
		Name: result.Organization.Name,
	}
	cfg.DefaultPersonalVK = config.PersonalVK{
		ID:     result.DefaultPersonalVK.ID,
		Secret: result.DefaultPersonalVK.Secret,
		Prefix: result.DefaultPersonalVK.Prefix,
	}

	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("✓ Logged in as %s\n", cfg.User.Email)
	if cfg.Organization.Name != "" {
		fmt.Printf("  Organization: %s\n", cfg.Organization.Name)
	}
	fmt.Printf("  Gateway: %s\n", cfg.GatewayURL)
	fmt.Println()
	fmt.Println("Try it:")
	fmt.Println("  langwatch claude         # use Claude Code")
	fmt.Println("  langwatch codex          # use Codex")
	fmt.Println("  langwatch cursor         # use Cursor")
	fmt.Println("  langwatch dashboard      # open your dashboard")
	return nil
}

func runLogout(ctx context.Context, _ []string) error {
	cfg, _ := config.Load()
	// Best-effort server-side revocation: if it fails (network down,
	// server returns an error), we still want to clear the local
	// credentials. The cli-login.feature scenario explicitly notes
	// that local wipe must happen even if revoke fails — otherwise
	// "logout" leaves a usable token on disk and the user has to
	// remember to delete the file manually.
	if cfg != nil && cfg.RefreshToken != "" {
		client := &auth.Client{BaseURL: cfg.ControlPlaneURL}
		if err := client.Revoke(ctx, cfg.RefreshToken); err != nil {
			fmt.Fprintf(os.Stderr, "warning: server-side revoke failed: %v\n", err)
		}
	}
	if err := config.Clear(); err != nil {
		return fmt.Errorf("clear config: %w", err)
	}
	fmt.Println("Logged out — credentials cleared.")
	return nil
}

func runWhoami(_ context.Context, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login`")
	}
	fmt.Printf("User:         %s\n", cfg.User.Email)
	if cfg.User.Name != "" {
		fmt.Printf("Name:         %s\n", cfg.User.Name)
	}
	if cfg.Organization.Name != "" {
		fmt.Printf("Organization: %s\n", cfg.Organization.Name)
	}
	fmt.Printf("Gateway:      %s\n", cfg.GatewayURL)
	fmt.Printf("Dashboard:    %s\n", cfg.ControlPlaneURL)
	if cfg.DefaultPersonalVK.Prefix != "" {
		fmt.Printf("Personal VK:  %s…\n", cfg.DefaultPersonalVK.Prefix)
	}
	return nil
}

func openBrowser(url string) error {
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

func spinner(done <-chan struct{}) {
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	t := time.NewTicker(120 * time.Millisecond)
	defer t.Stop()
	i := 0
	for {
		select {
		case <-done:
			return
		case <-t.C:
			fmt.Printf("\r%s Waiting for you to log in", frames[i%len(frames)])
			i++
		}
	}
}
