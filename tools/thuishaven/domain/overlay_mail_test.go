package domain

import "testing"

// @scenario "A stack with the mail lane sends its email into the sink"
func TestMailSMTPEnvInjectsWhenNoProviderIsConfigured(t *testing.T) {
	env := MailSMTPEnv(map[string]string{}, 45510)
	if got := valueOf(env, "EMAIL_PROVIDER"); got != "smtp" {
		t.Fatalf("EMAIL_PROVIDER = %q, want smtp", got)
	}
	if got := valueOf(env, "SMTP_HOST"); got != "127.0.0.1" {
		t.Fatalf("SMTP_HOST = %q, want 127.0.0.1", got)
	}
	if got := valueOf(env, "SMTP_PORT"); got != "45510" {
		t.Fatalf("SMTP_PORT = %q, want the sink's allocated SMTP port", got)
	}
	if got := valueOf(env, "SMTP_SECURE"); got != "false" {
		t.Fatalf("SMTP_SECURE = %q, want false", got)
	}
}

// @scenario "A provider the developer chose explicitly is left alone"
func TestMailSMTPEnvInjectsNothingWhenAProviderIsConfigured(t *testing.T) {
	for _, key := range MailProviderEnvVars {
		t.Run("given "+key+" is set", func(t *testing.T) {
			resolved := map[string]string{key: "already-configured"}
			if env := MailSMTPEnv(resolved, 45510); env != nil {
				t.Fatalf("MailSMTPEnv() = %v, want nil — %s must not be silently rewired", env, key)
			}
			if !HasEmailProviderConfigured(resolved) {
				t.Fatalf("HasEmailProviderConfigured() = false with %s set", key)
			}
		})
	}
}

func TestHasEmailProviderConfiguredIsFalseWithNoneOfTheKeysSet(t *testing.T) {
	if HasEmailProviderConfigured(map[string]string{"UNRELATED": "x"}) {
		t.Fatal("an unrelated env var must not read as a configured provider")
	}
}

// @scenario "A stack with the mail lane sends its email into the sink"
// @scenario "A provider key with no provider named does not keep mail off the sink"
func TestMailSMTPEnvInjectsOverABareProviderKey(t *testing.T) {
	for _, key := range []string{"SENDGRID_API_KEY", "RESEND_API_KEY"} {
		resolved := map[string]string{key: "copied-from-a-template"}
		if HasEmailProviderConfigured(resolved) {
			t.Fatalf("with only %s set, no provider is named, yet one reads as configured", key)
		}
		env := MailSMTPEnv(resolved, 45510)
		if got := valueOf(env, "EMAIL_PROVIDER"); got != "smtp" {
			t.Fatalf("with only %s set, EMAIL_PROVIDER = %q, want smtp", key, got)
		}
		if got := valueOf(env, "SMTP_HOST"); got != "127.0.0.1" {
			t.Fatalf("with only %s set, SMTP_HOST = %q, want the sink on loopback", key, got)
		}
		if got := valueOf(env, "SMTP_PORT"); got != "45510" {
			t.Fatalf("with only %s set, SMTP_PORT = %q, want the sink's port", key, got)
		}
	}
}
