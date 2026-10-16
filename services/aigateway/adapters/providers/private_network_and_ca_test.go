package providers

import (
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// The chat/messages dispatch runs on bifrost's own dialer, which refuses an
// RFC 1918 address unless the per-provider NetworkConfig.AllowPrivateNetwork is
// set. The gateway mirrors that flag from the operator's egress choice, so the
// dispatch config honors the same BLOCK_LOCAL_HTTP_CALLS the pre-flight
// validator does. Without the wiring the flag stays at its zero value and the
// dispatch refuses the endpoint even with the block off, which is the exact
// regression this pins.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
//
// @scenario "With the local-egress block off, dispatch is allowed to reach a private IP"
func TestGetConfigForProvider_AllowsPrivateNetworkWhenEgressBlockOff(t *testing.T) {
	cfg, err := (&account{allowPrivateNetwork: true}).GetConfigForProvider(bfschemas.OpenAI)
	if err != nil {
		t.Fatalf("GetConfigForProvider error: %v", err)
	}
	if !cfg.NetworkConfig.AllowPrivateNetwork {
		t.Fatal("AllowPrivateNetwork = false; dispatch would refuse an RFC 1918 endpoint even with the local-egress block off")
	}
}

// The safe default must survive: an account that did not opt in (the operator
// left the block on) produces a config that still refuses a private IP, so this
// change never widens egress on its own.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
//
// @scenario "With the local-egress block on, dispatch still refuses a private IP"
func TestGetConfigForProvider_RefusesPrivateNetworkByDefault(t *testing.T) {
	cfg, err := (&account{}).GetConfigForProvider(bfschemas.OpenAI)
	if err != nil {
		t.Fatalf("GetConfigForProvider error: %v", err)
	}
	if cfg.NetworkConfig.AllowPrivateNetwork {
		t.Fatal("AllowPrivateNetwork = true by default; a provider on a private IP would be reachable without the operator opting in")
	}
}

// A configured internal CA must reach the per-provider NetworkConfig so
// bifrost merges it into the trusted roots. The PEM is a literal here; the
// value survives onto CACertPEM and verification is never turned off. Without
// the wiring CACertPEM stays nil and an internal-CA endpoint fails the TLS
// handshake, which is the second half of the regression.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
//
// @scenario "A configured internal CA is carried onto the dispatch config"
func TestGetConfigForProvider_CarriesConfiguredCACert(t *testing.T) {
	const pem = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----"
	cfg, err := (&account{providerCACertPEM: pem}).GetConfigForProvider(bfschemas.OpenAI)
	if err != nil {
		t.Fatalf("GetConfigForProvider error: %v", err)
	}
	if cfg.NetworkConfig.CACertPEM == nil {
		t.Fatal("CACertPEM is nil; an operator-provided internal CA would not be trusted and provider TLS would fail with unknown authority")
	}
	if got := cfg.NetworkConfig.CACertPEM.GetValue(); got != pem {
		t.Fatalf("CACertPEM value = %q, want the configured PEM carried through verbatim", got)
	}
	if cfg.NetworkConfig.InsecureSkipVerify {
		t.Fatal("InsecureSkipVerify = true; trusting an internal CA must never disable certificate verification")
	}
}

// With no CA configured the config must leave the system roots alone: CACertPEM
// stays nil so bifrost's networkTLSConfig is a no-op and the default trust store
// is used unchanged.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
//
// @scenario "With no CA configured, dispatch keeps the system roots alone"
func TestGetConfigForProvider_NoCACertLeavesRootsAlone(t *testing.T) {
	cfg, err := (&account{}).GetConfigForProvider(bfschemas.OpenAI)
	if err != nil {
		t.Fatalf("GetConfigForProvider error: %v", err)
	}
	if cfg.NetworkConfig.CACertPEM != nil {
		t.Fatalf("CACertPEM = %+v, want nil so the system roots are used unchanged", cfg.NetworkConfig.CACertPEM)
	}
	if cfg.NetworkConfig.InsecureSkipVerify {
		t.Fatal("InsecureSkipVerify = true without any CA configured; verification must stay on")
	}
}

// Guard the resolver contract the CA field depends on: an `env.*` reference is
// resolved from the environment, while a literal PEM is carried through as-is.
// This is the behavior NewEnvVar gives GetConfigForProvider, and the reason the
// field accepts both a literal and a reference.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature
//
// @scenario "A configured internal CA is carried onto the dispatch config"
func TestGetConfigForProvider_CACertResolvesEnvReference(t *testing.T) {
	const pem = "-----BEGIN CERTIFICATE-----\nMIIBenv\n-----END CERTIFICATE-----"
	t.Setenv("GATEWAY_TEST_CA_PEM", pem)

	cfg, err := (&account{providerCACertPEM: "env.GATEWAY_TEST_CA_PEM"}).GetConfigForProvider(bfschemas.OpenAI)
	if err != nil {
		t.Fatalf("GetConfigForProvider error: %v", err)
	}
	if cfg.NetworkConfig.CACertPEM == nil {
		t.Fatal("CACertPEM is nil for an env.* reference; the CA from the environment was not resolved")
	}
	if got := cfg.NetworkConfig.CACertPEM.GetValue(); !strings.Contains(got, "MIIBenv") {
		t.Fatalf("CACertPEM value = %q, want the PEM resolved from the referenced environment variable", got)
	}
}
