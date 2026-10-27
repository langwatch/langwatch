package readmegen

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func scalar(value string) Scalar { return Scalar{Value: value, Resolved: true} }

// TestAddressesFollowTheFamilyAddressing pins the Go port to addressing.ts and runtime.ts.
func TestAddressesFollowTheFamilyAddressing(t *testing.T) {
	cases := []struct {
		name   string
		family RestFamily
		path   string
		want   []string
	}{
		{"dated collection", RestFamily{Namespace: scalar("slack-connections"), Version: scalar("2026-08-07"), Addressing: "dated", V1Twin: true}, "/",
			[]string{"/api/slack-connections/2026-08-07 /api/v1/slack-connections/2026-08-07", "/api/slack-connections/latest /api/v1/slack-connections/latest", "/api/slack-connections /api/v1/slack-connections"}},
		{"dated without twin", RestFamily{Namespace: scalar("x"), Version: scalar("2026-08-07"), Addressing: "dated"}, "/:id",
			[]string{"/api/x/2026-08-07/:id ", "/api/x/latest/:id ", "/api/x/:id "}},
		{"v1 in path", RestFamily{Namespace: scalar("webhooks"), Addressing: "v1-in-path", Generation: "v1", V1Twin: true}, "/endpoints",
			[]string{"/api/webhooks/v1/endpoints "}},
		{"v1 only", RestFamily{Namespace: scalar("scim"), Addressing: "v1-only"}, "/",
			[]string{"/api/v1/scim "}},
		{"literal with twin", RestFamily{Namespace: scalar("otel"), Addressing: "literal", V1Twin: true}, "/api/otel/v1/traces",
			[]string{"/api/otel/v1/traces "}},
		{"literal at the root", RestFamily{Namespace: scalar("otel"), Addressing: "literal", V1Twin: true}, "/v1/traces",
			[]string{"/v1/traces "}},
	}
	for index := range cases {
		c := &cases[index]
		var got []string
		for _, address := range addressesOf(&RestRoute{Path: scalar(c.path)}, &c.family) {
			got = append(got, address.path+" "+address.alias)
		}
		if strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestCheckFailsWhenTheMountedRegistryDisagrees(t *testing.T) {
	root := writeFixture(t)
	data, err := os.ReadFile(filepath.Join("testdata", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Mounted.Routes = append(manifest.Mounted.Routes, MountedRoute{Method: "DELETE", Path: "/api/alpha-items/:id", Family: "alpha-items"})
	var stderr bytes.Buffer
	if count := crossCheck(manifest, &stderr); count != 1 {
		t.Fatalf("crossCheck counted %d disagreeing families, want 1:\n%s", count, stderr.String())
	}
	for _, want := range []string{`REST "alpha-items": mounted but not read: DELETE /api/alpha-items/:id; read but not mounted: –`} {
		if !strings.Contains(stderr.String(), want) {
			t.Errorf("stderr lacks %q:\n%s", want, stderr.String())
		}
	}
	if code, _, _ := runReadmegen(t, "--write", "--root", root); code != 0 {
		t.Fatalf("--write refused the agreeing fixture")
	}
}

func TestPeriodNamesTheLargestWholeUnit(t *testing.T) {
	for ms, want := range map[string]string{"60000": "every 1 min", "5000": "every 5 s", "86400000": "every 1 d", "1500": "every 1500 ms"} {
		if got := period(&Schedule{EveryMs: scalar(ms)}); got != want {
			t.Errorf("period(%s) = %q, want %q", ms, got, want)
		}
	}
}

func TestASchemaImportFailureStopsTheRun(t *testing.T) {
	root := writeFixture(t)
	data, err := os.ReadFile(filepath.Join("testdata", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Schemas.Errors = []string{"modules/alpha/contract/src/alpha.trpc.ts: Cannot find module"}
	broken := filepath.Join(t.TempDir(), "manifest.json")
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(broken, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"--write", "--root", root, "--manifest", broken}, &stdout, &stderr); code != 1 ||
		!strings.Contains(stderr.String(), "the zod schemas could not be read (1 imports failed") {
		t.Fatalf("a failed schema import wrote pages without their contracts (exit %d):\n%s", code, stderr.String())
	}
}
