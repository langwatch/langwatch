package domain

import (
	"strings"
	"testing"
)

func TestLicencePublicKeyPairsWithTheMintedKey(t *testing.T) {
	private, err := MintLicenceKey()
	if err != nil {
		t.Fatal(err)
	}
	public, err := LicencePublicKey(private)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(public), "-----BEGIN PUBLIC KEY-----") {
		t.Fatal("the public half must be SPKI PEM, the shape the verifier reads")
	}
	if strings.Contains(string(public), "PRIVATE") {
		t.Fatal("the public half must carry no private material")
	}
	if _, err := LicencePublicKey([]byte("not a key")); err == nil {
		t.Fatal("a non-PEM key must be refused")
	}
}

func TestStackLicenceEnvYieldsToTheDevelopersPair(t *testing.T) {
	pem := []byte("-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n")
	got := StackLicenceEnv(LicencePublicKeyVar, pem, map[string]string{})
	want := LicencePublicKeyVar + `=-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----`
	if len(got) != 1 || got[0] != want {
		t.Fatalf("StackLicenceEnv() = %q, want one escaped line %q", got, want)
	}
	for _, set := range []string{LicencePublicKeyVar, LicencePrivateKeyVar} {
		if env := StackLicenceEnv(LicencePublicKeyVar, pem, map[string]string{set: "mine"}); env != nil {
			t.Fatalf("with %s set by the developer, injected %q; their pair must win whole", set, env)
		}
	}
	if env := StackLicenceEnv(LicencePublicKeyVar, nil, map[string]string{}); env != nil {
		t.Fatal("no key, nothing injected")
	}
}
