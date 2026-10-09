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
