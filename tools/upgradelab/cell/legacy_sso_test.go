package cell

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"
	"testing"
)

func TestLegacyProfileBootsMainsAuth0OnTheProxy(t *testing.T) {
	stores := Stores{PostgresBase: "postgresql://u:p@127.0.0.1:5432", ClickHouseBase: "http://u:p@127.0.0.1:8123", Name: "upgradelab_x", RedisPort: "6400",
		IDP: 7200, IDPPublic: "https://127.0.0.1:7201", IDPCA: "/run/idp-ca.pem"}
	env, err := BuildEnv(EnvInput{Profile: Profiles["cloud-legacy-sso"], Stores: stores, APIPort: 7100, Admin: "seed+1@snapshot.test"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"NEXTAUTH_PROVIDER": "auth0", "AUTH0_ISSUER": "https://127.0.0.1:7201/", "NODE_EXTRA_CA_CERTS": "/run/idp-ca.pem",
		"LOCAL_PASSWORDS_ENABLED": "on", "SSO_TRUSTED_IDP_ORIGINS": "https://127.0.0.1:7201"}
	for key, value := range want {
		if env[key] != value {
			t.Errorf("%s = %q, want %q", key, env[key], value)
		}
	}
	if provider, ok := env["AUTH_PROVIDER"]; ok {
		t.Errorf("AUTH_PROVIDER %q outranks main's NEXTAUTH_PROVIDER", provider)
	}
	if _, ok := env["OIDC_ISSUER"]; ok {
		t.Error("an Auth0 deployment's .env holds no OIDC_ISSUER")
	}
	plain, _ := BuildEnv(EnvInput{Profile: Profiles["cloud-sso"], Stores: Stores{Name: "upgradelab_x", IDP: 7200}, APIPort: 7100})
	if plain["NEXTAUTH_PROVIDER"] != "oidc" || plain["OIDC_ISSUER"] != "http://127.0.0.1:7200/t/1" {
		t.Errorf("cloud-sso keeps its plain OIDC door: %q %q", plain["NEXTAUTH_PROVIDER"], plain["OIDC_ISSUER"])
	}
}

func TestProxyCertificateCoversLoopback(t *testing.T) {
	served, pemBytes, err := proxyCertificates()
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(pemBytes)
	ca, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(served.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if !ca.IsCA || leaf.IsCA || leaf.Equal(ca) {
		t.Fatalf("the trusted PEM is the CA and the served certificate a leaf it signed: ca %v leaf %v", ca.IsCA, leaf.IsCA)
	}
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: pool, DNSName: "127.0.0.1"}); err != nil {
		t.Errorf("trusting the PEM must verify the leaf for 127.0.0.1: %v", err)
	}
}

func TestLegacyMemberIsJudgedOnAccountMembershipAndKey(t *testing.T) {
	member := "member@acme1.test"
	results := []SSOResult{{Phase: "main", Member: member, Check: "signin", OK: true}, {Phase: "head", Member: member, Check: "signin", OK: true}}
	good := legacyInput{Member: member, Results: results, Providers: []string{"auth0"}, Before: []string{"org1:MEMBER"}, After: []string{"org1:MEMBER"}}
	if got := judgeLegacy(good); got.Result != "pass" {
		t.Errorf("all held: %s", got.Detail)
	}
	bad := good
	bad.Providers, bad.After, bad.APIKey = []string{"credential"}, []string{"org1:VIEWER"}, errors.New("GET /api/prompts answered 401")
	got := judgeLegacy(bad)
	for _, want := range []string{"no auth0 account", "org1:VIEWER", "401"} {
		if got.Result != "fail" || !strings.Contains(got.Detail, want) {
			t.Errorf("want %q in a failure, got %s: %s", want, got.Result, got.Detail)
		}
	}
	if got := judgeLegacy(legacyInput{Member: member, Providers: []string{"auth0"}, Before: []string{"o:M"}, After: []string{"o:M"}}); !strings.Contains(got.Detail, "head/signin: never ran") {
		t.Errorf("a sign-in that never ran fails: %s", got.Detail)
	}
}

func TestOthersKeepTheirStanding(t *testing.T) {
	before := parseStanding("seed@x|org1:ADMIN\nmember@acme3.test|org2:MEMBER\n")
	if got := judgeOthers(othersInput{Emails: []string{"seed@x", "member@acme3.test"}, Before: before, After: before, Password: "seed@x"}); got.Result != "pass" {
		t.Errorf("unchanged: %s", got.Detail)
	}
	after := parseStanding("seed@x|org1:ADMIN\n")
	got := judgeOthers(othersInput{Emails: []string{"seed@x", "member@acme3.test"}, Before: before, After: after, PasswordErr: errors.New("401")})
	if got.Result != "fail" || !strings.Contains(got.Detail, "member@acme3.test memberships [org2:MEMBER] on main, [] on head") || !strings.Contains(got.Detail, "401") {
		t.Errorf("lost membership and password: %s", got.Detail)
	}
}
