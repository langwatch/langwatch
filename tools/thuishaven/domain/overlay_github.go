package domain

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"sync"
)

// The GitHub App haven names when githubsim runs. githubsim checks the App id in
// a JWT's claims and nothing else, so the key only has to be a valid RSA key.
const (
	GithubSimAppID         = "424242"
	GithubSimAppSlug       = "langwatch-sim"
	GithubSimWebhookSecret = "whsec_githubsim"
)

var (
	githubSimKeyOnce sync.Once
	githubSimKey     string
)

// githubSimPrivateKey is one RSA key per haven process, with newlines written
// as \n so it survives a single-line environment value.
func githubSimPrivateKey() string {
	githubSimKeyOnce.Do(func() {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return
		}
		block := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
		githubSimKey = strings.ReplaceAll(strings.TrimSpace(string(block)), "\n", `\n`)
	})
	return githubSimKey
}

// GithubAppEnv points the github module's App, API and install page at githubsim
// at endpoint, or nil when the developer named a GitHub App of their own.
func GithubAppEnv(resolved map[string]string, endpoint string) []string {
	if resolved["GITHUB_LANGY_APP_ID"] != "" || githubSimPrivateKey() == "" {
		return nil
	}
	return []string{
		"GITHUB_LANGY_APP_ID=" + GithubSimAppID,
		"GITHUB_LANGY_APP_SLUG=" + GithubSimAppSlug,
		"GITHUB_LANGY_PRIVATE_KEY=" + githubSimPrivateKey(),
		"GITHUB_LANGY_WEBHOOK_SECRET=" + GithubSimWebhookSecret,
		"GITHUB_LANGY_API_BASE=" + endpoint,
		"GITHUB_LANGY_WEB_BASE=" + endpoint,
	}
}
