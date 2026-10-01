package apidiff

import (
	"testing"

	"github.com/langwatch/langwatch/tools/havenrun"
)

func TestStackServingMatchesTheAPIPortOrTheRoutedOrigin(t *testing.T) {
	status := havenrun.Status{Stacks: []havenrun.StackStatus{
		{Slug: "other", APIPort: 1111},
		{Slug: "check", APIPort: 63959, Services: []havenrun.ServiceItem{{Name: "app", URL: "https://app.check.langwatch.localhost"}}},
	}}
	for _, baseURL := range []string{"http://127.0.0.1:63959", "https://app.check.langwatch.localhost"} {
		if stack, ok := stackServing(status, baseURL); !ok || stack.Slug != "check" {
			t.Fatalf("stackServing(%q) = %q, %v; want check", baseURL, stack.Slug, ok)
		}
	}
	if _, ok := stackServing(status, "http://127.0.0.1:9"); ok {
		t.Fatal("a URL no stack serves must match nothing")
	}
}

func TestApplyHavenCredentialsNeverOverridesAFlag(t *testing.T) {
	keys := Keys{AdminKey: "from-flag"}
	filled := applyHavenCredentials(map[string]string{
		"LANGWATCH_INSTANCE_ADMIN_API_KEY": "from-haven", "HAVEN_SEED_SCIM_TOKEN": "scim",
	}, &keys, func(string, string) int { return 200 })
	if keys.AdminKey != "from-flag" || keys.ScimKey != "scim" || len(filled) != 1 {
		t.Fatalf("keys = %+v, filled = %v", keys, filled)
	}
}

func TestApplyHavenCredentialsDropsAKeyTheStackRefuses(t *testing.T) {
	keys := Keys{}
	applyHavenCredentials(map[string]string{"LANGWATCH_INSTANCE_ADMIN_API_KEY": "stale"}, &keys,
		func(string, string) int { return 401 })
	if keys.AdminKey != "" {
		t.Fatal("a key the running stack refuses must not replace the seeded-organization fallback")
	}
}

func TestBrowserOriginIsTheStacksAppOriginOnceKnown(t *testing.T) {
	stack := havenrun.StackStatus{Services: []havenrun.ServiceItem{{Name: "app", URL: "https://app.check.langwatch.localhost"}}}
	rememberAppOrigin("http://127.0.0.1:40001/", stack)
	if got := browserOrigin("http://127.0.0.1:40001"); got != "https://app.check.langwatch.localhost" {
		t.Fatalf("browserOrigin = %q, want the app origin better-auth trusts", got)
	}
	if got := browserOrigin("http://127.0.0.1:40002"); got != "http://localhost:40002" {
		t.Fatalf("an unknown URL keeps the localhost origin, got %q", got)
	}
}
