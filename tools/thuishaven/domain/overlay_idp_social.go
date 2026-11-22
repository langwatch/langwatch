package domain

import "fmt"

// IdpSocialTenant is the idpsim tenant that plays the four social providers under
// +idp: tenant 1, whose seeded users are admin@acme1.test and member@acme1.test.
const IdpSocialTenant = 1

// IdpSocialSignInEnv points the auth module's Google, GitHub, GitLab and Microsoft
// sign-in at idpsim's /t/<n>/social/<provider>. Better Auth's Google and GitHub
// hard-wire their hosts, so these bases are the only way a dev stack reaches the
// simulator. Client ids and secrets are not set here: idpsim accepts any.
func IdpSocialSignInEnv(idpURL string) []string {
	base := fmt.Sprintf("%s/t/%d/social", idpURL, IdpSocialTenant)
	return []string{
		"GOOGLE_SIGN_IN_BASE=" + base + "/google",
		"GITHUB_SIGN_IN_BASE=" + base + "/github",
		"GITLAB_SIGN_IN_BASE=" + base + "/gitlab",
		"MICROSOFT_SIGN_IN_BASE=" + base + "/microsoft",
	}
}
