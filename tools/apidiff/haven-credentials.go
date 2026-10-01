package apidiff

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// A single-stack scenarios run against a haven stack takes the credentials
// haven generated for it (tools/thuishaven/domain/stackcreds.go) instead of
// needing -admin-key and -scim-key: read with `haven env --json --reveal`
// into memory, never printed.

// havenCredential is one overlay key, the Keys field it fills, and the read
// that proves the running stack accepts it.
type havenCredential struct {
	field func(*Keys) *string
	check string
}

// havenCredentialKeys maps the haven overlay key to the Keys field it fills.
var havenCredentialKeys = map[string]havenCredential{
	"LANGWATCH_INSTANCE_ADMIN_API_KEY": {field: func(keys *Keys) *string { return &keys.AdminKey }, check: "/api/organizations"},
	"HAVEN_SEED_SCIM_TOKEN":            {field: func(keys *Keys) *string { return &keys.ScimKey }, check: "/api/scim/v2/ServiceProviderConfig"},
}

// fillHavenCredentials fills every empty admin/SCIM key from the haven stack
// serving baseURL, and says which it filled; it also records the stack's app
// origin, the only Origin its sign-in trusts. No haven, or no stack serving
// the URL, fills nothing: the flags stay the way to name a key.
func fillHavenCredentials(ctx context.Context, baseURL string, keys *Keys) ([]string, error) {
	stack, found, err := havenStackServing(ctx, baseURL)
	if err != nil || !found {
		return nil, err
	}
	slug := stack.Slug
	command := exec.CommandContext(ctx, havenrun.Command, "env", "--json", "--reveal") //nolint:gosec // fixed haven binary and arguments
	command.Env = append(os.Environ(), "LANGWATCH_SLUG="+slug)
	envOut, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("haven env for %s: %w", slug, err)
	}
	overlay := map[string]string{}
	if err := json.Unmarshal(envOut, &overlay); err != nil {
		return nil, fmt.Errorf("haven env for %s: %w", slug, err)
	}
	return applyHavenCredentials(overlay, keys, func(path, token string) int {
		return bearerStatus(ctx, baseURL+path, token)
	}), nil
}

// applyHavenCredentials copies into the empty keys each overlay credential
// the running stack accepts. A stack started before haven minted the key
// refuses it; the run then goes on without it, as it did before.
func applyHavenCredentials(overlay map[string]string, keys *Keys, status func(path, token string) int) []string {
	filled := make([]string, 0, len(havenCredentialKeys))
	for envKey, credential := range havenCredentialKeys {
		target := credential.field(keys)
		if *target != "" || overlay[envKey] == "" {
			continue
		}
		if code := status(credential.check, overlay[envKey]); code == 0 || code == http.StatusUnauthorized || code == http.StatusForbidden {
			filled = append(filled, fmt.Sprintf("%s (GET %s answered %d: not used; restart a stack that predates the key)", envKey, credential.check, code))
			continue
		}
		*target = overlay[envKey]
		filled = append(filled, envKey)
	}
	return filled
}

// bearerStatus is the status a GET with the bearer token answers, 0 when the
// stack did not answer.
func bearerStatus(ctx context.Context, target, token string) int {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return 0
	}
	defer response.Body.Close()
	return response.StatusCode
}

// havenStackServing finds the haven stack serving baseURL and records its app
// origin, so a sign-in posted to any of its ports sends the origin it trusts.
// No haven, or no stack serving the URL, finds nothing.
func havenStackServing(ctx context.Context, baseURL string) (havenrun.StackStatus, bool, error) {
	if !havenrun.OnPath() {
		return havenrun.StackStatus{}, false, nil
	}
	statusOut, err := exec.CommandContext(ctx, havenrun.Command, havenrun.StatusArgs()...).Output() //nolint:gosec // fixed haven binary and arguments
	if err != nil {
		return havenrun.StackStatus{}, false, fmt.Errorf("haven status: %w", err)
	}
	status, err := havenrun.ParseStatus(statusOut)
	if err != nil {
		return havenrun.StackStatus{}, false, err
	}
	stack, found := stackServing(status, baseURL)
	if found {
		rememberAppOrigin(baseURL, stack)
	}
	return stack, found, nil
}

// rememberHavenOrigins records the app origin of each haven stack serving one
// of the URLs; a URL no stack serves keeps the loopback fallback.
func rememberHavenOrigins(ctx context.Context, urls ...string) error {
	for _, baseURL := range urls {
		if _, _, err := havenStackServing(ctx, baseURL); err != nil {
			return err
		}
	}
	return nil
}

// stackServing finds the stack whose API port, a service's port (the UI dev
// server's, say) or routed origin is baseURL's.
func stackServing(status havenrun.Status, baseURL string) (havenrun.StackStatus, bool) {
	target, err := url.Parse(baseURL)
	if err != nil {
		return havenrun.StackStatus{}, false
	}
	for _, stack := range status.Stacks {
		if (target.Port() != "" && target.Port() == strconv.Itoa(stack.APIPort)) || servesTarget(stack, target) {
			return stack, true
		}
	}
	return havenrun.StackStatus{}, false
}

// servesTarget reports whether one of the stack's services is target, by
// routed host or by loopback port.
func servesTarget(stack havenrun.StackStatus, target *url.URL) bool {
	for _, service := range stack.Services {
		if service.Port != 0 && strconv.Itoa(service.Port) == target.Port() {
			return true
		}
		if routed, err := url.Parse(service.URL); err == nil && service.URL != "" && routed.Host == target.Host {
			return true
		}
	}
	return false
}

// serviceMailURL is the mail sink of the haven stack serving baseURL; empty
// when there is no haven, no such stack or no sink.
func serviceMailURL(ctx context.Context, baseURL string) string {
	if baseURL == "" {
		return ""
	}
	stack, found, err := havenStackServing(ctx, baseURL)
	if err != nil || !found {
		return ""
	}
	address, _ := stack.ServiceURL(havenMailService)
	return address
}
