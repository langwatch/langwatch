package domain

import (
	"slices"
	"testing"
)

// @scenario "haven runs voicesim only when the worktree asks for it"
func TestVoiceProviderEnvPointsTheSDKAtVoicesim(t *testing.T) {
	if DefaultSelection().Voice {
		t.Fatal("voice is on in a fresh worktree's selection; it must be opt-in")
	}
	sel, err := applySelectionDelta(DefaultSelection(), VoiceService, true)
	if err != nil || !sel.Voice {
		t.Fatalf("+voice = %+v, %v", sel, err)
	}
	env := VoiceProviderEnv(map[string]string{"ELEVENLABS_API_KEY": "real"}, 45591)
	want := []string{
		"ELEVENLABS_BASE_URL=http://127.0.0.1:45591",
		"VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1",
		"ALLOWED_PROXY_HOSTS=127.0.0.1",
	}
	if !slices.Equal(env, want) {
		t.Errorf("overlay = %v, want %v", env, want)
	}
}

// @scenario "haven seeds the ElevenLabs provider at voicesim"
func TestVoiceProviderEnvAddsADummyKeyWhenNoneIsSet(t *testing.T) {
	env := VoiceProviderEnv(map[string]string{}, 45591)
	want := []string{
		"ELEVENLABS_BASE_URL=http://127.0.0.1:45591",
		"VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1",
		"ALLOWED_PROXY_HOSTS=127.0.0.1",
		"ELEVENLABS_API_KEY=voicesim",
	}
	if !slices.Equal(env, want) {
		t.Errorf("overlay = %v, want %v", env, want)
	}
}

// @scenario "A developer's own ElevenLabs host wins"
func TestVoiceProviderEnvStaysOutOfAChosenHost(t *testing.T) {
	if env := VoiceProviderEnv(map[string]string{"ELEVENLABS_BASE_URL": "https://api.elevenlabs.io"}, 45591); env != nil {
		t.Errorf("with ELEVENLABS_BASE_URL set the overlay is %v, want nothing (no dev switch either)", env)
	}
}
