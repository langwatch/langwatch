package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven points billing at paymentsim only when no Stripe credential is set"
func TestPaymentProviderEnv(t *testing.T) {
	got := PaymentProviderEnv(map[string]string{}, "https://payment.s.langwatch.localhost")
	want := []string{"STRIPE_API_BASE=https://payment.s.langwatch.localhost", "STRIPE_SECRET_KEY=" + PaymentSimSecretKey, "STRIPE_WEBHOOK_SECRET=" + PaymentSimWebhookSecret}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v", got)
	}
	for _, key := range []string{"STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_API_BASE"} {
		if env := PaymentProviderEnv(map[string]string{key: "set"}, "x"); env != nil {
			t.Fatalf("%s set, still rewired: %v", key, env)
		}
	}
}

// @scenario "haven up says which Stripe billing talks to"
func TestStripeNotice(t *testing.T) {
	cases := []struct {
		resolved map[string]string
		isOn     bool
		want     string
	}{
		{map[string]string{}, true, "Stripe: paymentsim"},
		{map[string]string{"STRIPE_SECRET_KEY": "sk_test_x"}, true, "Stripe: your test key from .env"},
		{map[string]string{"STRIPE_SECRET_KEY": "sk_test_x"}, false, "Stripe: your test key from .env"},
		{map[string]string{"STRIPE_SECRET_KEY": "sk_test_x", "STRIPE_API_BASE": "http://stripe.local"}, true, "Stripe: custom base http://stripe.local"},
		{map[string]string{}, false, "Stripe: none, billing is off (`haven up +payment` starts paymentsim)"},
	}
	for _, c := range cases {
		if got := StripeNotice(c.resolved, c.isOn); got != c.want {
			t.Errorf("StripeNotice(%v, %v) = %q, want %q", c.resolved, c.isOn, got, c.want)
		}
	}
	if !DefaultSelection().Payment {
		t.Error("paymentsim is off on a default haven up")
	}
}

// @scenario "haven refuses a live Stripe key"
func TestRefuseLiveStripe(t *testing.T) {
	for _, key := range []string{"sk_live_abc", "rk_live_abc"} {
		err := RefuseLiveStripe(map[string]string{"STRIPE_SECRET_KEY": key})
		if err == nil || !strings.Contains(err.Error(), "STRIPE_SECRET_KEY") || strings.Contains(err.Error(), key) {
			t.Errorf("live key: err = %v, want a refusal naming the variable, not the value", err)
		}
	}
	for _, resolved := range []map[string]string{
		{},
		{"STRIPE_SECRET_KEY": "sk_test_abc"},
		{"STRIPE_SECRET_KEY": "sk_test_abc", "STRIPE_API_BASE": "http://stripe.local"},
	} {
		if err := RefuseLiveStripe(resolved); err != nil {
			t.Errorf("RefuseLiveStripe(%v) = %v, want nil", resolved, err)
		}
	}
	if env := PaymentProviderEnv(map[string]string{"STRIPE_SECRET_KEY": "sk_test_abc"}, "x"); env != nil {
		t.Errorf("a test key without a base was rewired: %v", env)
	}
}
