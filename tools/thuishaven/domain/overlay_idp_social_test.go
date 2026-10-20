package domain

import (
	"slices"
	"testing"
)

func TestIdpSocialSignInEnvNamesTheTenantsSocialProviders(t *testing.T) {
	env := IdpSocialSignInEnv("https://idp.s.langwatch.localhost")
	for _, want := range []string{
		"GOOGLE_SIGN_IN_BASE=https://idp.s.langwatch.localhost/t/1/social/google",
		"GITHUB_SIGN_IN_BASE=https://idp.s.langwatch.localhost/t/1/social/github",
		"GITLAB_SIGN_IN_BASE=https://idp.s.langwatch.localhost/t/1/social/gitlab",
		"MICROSOFT_SIGN_IN_BASE=https://idp.s.langwatch.localhost/t/1/social/microsoft",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("env lacks %s", want)
		}
	}
}
