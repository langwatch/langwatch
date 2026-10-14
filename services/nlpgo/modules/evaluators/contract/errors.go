package contract

import (
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
)

// The module's error codes (plan §3.4). The TS LangevalsChannel maps each to a
// HandledError; the wire is internal, so herr's envelope is acceptable here.
const (
	ErrUnauthorized             herr.Code = "unauthorized"
	ErrTenantMissing            herr.Code = "tenant_missing"
	ErrEvaluatorNotFound        herr.Code = "evaluator_not_found"
	ErrEvaluatorSettingsInvalid herr.Code = "evaluator_settings_invalid"
	ErrPayloadTooLarge          herr.Code = "evaluation_payload_too_large"
	ErrBusy                     herr.Code = "evaluation_busy"
)

// RegisterStatuses maps the codes to HTTP statuses. Idempotent; call once at
// router construction.
func RegisterStatuses() {
	herr.RegisterStatus(ErrUnauthorized, http.StatusUnauthorized)
	herr.RegisterStatus(ErrTenantMissing, http.StatusBadRequest)
	herr.RegisterStatus(ErrEvaluatorNotFound, http.StatusNotFound)
	herr.RegisterStatus(ErrEvaluatorSettingsInvalid, http.StatusBadRequest)
	herr.RegisterStatus(ErrPayloadTooLarge, http.StatusRequestEntityTooLarge)
	herr.RegisterStatus(ErrBusy, http.StatusTooManyRequests)
}
