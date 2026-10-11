package domain

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/url"
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
// at endpoint. +github is an explicit opt-in, so the whole set wins over an App
// in .env: a half-real set sends the sim's signed webhooks to a real secret (401).
func GithubAppEnv(endpoint string) []string {
	if githubSimPrivateKey() == "" {
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

// GithubLangyEnv points Langy's worker gh and git at githubsim at endpoint (its
// portless URL): LANGY_GITHUB_HOST is the host and port with no scheme. Nil
// when endpoint has no host.
func GithubLangyEnv(endpoint string) []string {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return nil
	}
	return []string{"LANGY_GITHUB_HOST=" + u.Host}
}
