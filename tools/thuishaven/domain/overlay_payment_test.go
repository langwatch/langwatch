package domain

import (
	"slices"
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
		{map[string]string{"STRIPE_SECRET_KEY": "set"}, true, "Stripe: your key from .env"},
		{map[string]string{"STRIPE_SECRET_KEY": "set"}, false, "Stripe: your key from .env"},
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
