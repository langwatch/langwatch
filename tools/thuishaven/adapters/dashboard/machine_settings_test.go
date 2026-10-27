package dashboard

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestMachineSettingsOverHTTP(t *testing.T) {
	var got struct{ name, value string }
	s := New(Config{
		Stacks:    func() []domain.Stack { return nil },
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		MachineSettings: MachineSettings{
			Report: func() []domain.MachineSettingView { return domain.MachineSettings{}.View() },
			Set: func(_ context.Context, name, value string) (string, error) {
				if value == "maybe" {
					return "", errors.New("observability is on or off")
				}
				got.name, got.value = name, value
				return name + " saved", nil
			},
		},
	})

	t.Run("when the page reads the settings", func(t *testing.T) {
		rec := limitRequest(s, http.MethodGet, "/api/machine-settings", "", false)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"runtime-auto-stop"`) {
			t.Fatalf("status %d body %s", rec.Code, rec.Body)
		}
	})

	t.Run("when the page flips a switch", func(t *testing.T) {
		rec := limitRequest(s, http.MethodPut, "/api/machine-settings/observability", `{"value": "off"}`, true)
		if rec.Code != http.StatusOK || got.name != "observability" || got.value != "off" {
			t.Fatalf("status %d, got %+v, body %s", rec.Code, got, rec.Body)
		}
	})

	t.Run("when the page resets a setting", func(t *testing.T) {
		rec := limitRequest(s, http.MethodDelete, "/api/machine-settings/observability", "", true)
		if rec.Code != http.StatusOK || got.value != "" {
			t.Fatalf("status %d, got %+v", rec.Code, got)
		}
	})

	t.Run("when the value is refused", func(t *testing.T) {
		rec := limitRequest(s, http.MethodPut, "/api/machine-settings/observability", `{"value": "maybe"}`, true)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "on or off") {
			t.Errorf("status %d body %s", rec.Code, rec.Body)
		}
	})

	t.Run("when another site asks", func(t *testing.T) {
		rec := limitRequest(s, http.MethodPut, "/api/machine-settings/observability", `{"value": "off"}`, false)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status %d, want 403", rec.Code)
		}
	})
}
