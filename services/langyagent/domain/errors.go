// Package domain holds the langyagent service's value objects and error
// codes. It depends only on the shared pkg/ toolkit — never on app or
// adapters — so both the driving (httpapi) and driven (workerpool) sides can
// import it without a cycle.
package domain

import (
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
)

// Error codes returned across the langyagent service. HTTP-surface codes are
// mapped to statuses in RegisterStatuses (called once from the router). The
// codes double as sentinels: because herr.E.Is compares on Code, callers use
// `errors.Is(err, domain.ErrMaxWorkers)` on a herr.E built with New(ctx,
// ErrMaxWorkers, ...) exactly as they used the old `errors.New` sentinels.
const (
	// ErrUnauthorized signals a missing or invalid internal bearer secret on
	// /chat. The manager binds the cluster service surface, so this is the
	// wall against any pod that can route to it.
	ErrUnauthorized = herr.Code("unauthorized")

	// ErrBadRequest is the catch-all for a malformed /chat body (unreadable,
	// invalid JSON, missing required fields).
	ErrBadRequest = herr.Code("bad_request")

	// ErrPayloadTooLarge signals the /chat body exceeded MaxRequestBodyBytes.
	ErrPayloadTooLarge = herr.Code("payload_too_large")

	// ErrInvalidConversationID signals a conversationId that is not a safe
	// path segment (would escape SESSIONS_ROOT).
	ErrInvalidConversationID = herr.Code("invalid_conversation_id")

	// ErrConversationBusy signals a second concurrent turn for a conversation
	// whose single-stream opencode session is already answering. The control
	// plane shows a "still answering — wait" notice. Maps to 409.
	ErrConversationBusy = herr.Code("conversation_busy")

	// ErrMaxWorkers signals LANGY_MAX_WORKERS is reached. The chat orchestrator
	// converts it into a 200 ndjson {type:"error",error:"at-capacity"} event so
	// the control plane can show a graceful "agent busy" instead of a 5xx — it
	// never reaches WriteHTTP, but is still registered (503) for completeness.
	ErrMaxWorkers = herr.Code("max_workers_reached")

	// ErrNoFreeUID signals every UID slot in the per-worker range is in use.
	// With 60_000 slots and a default MAX_WORKERS of 20 this cannot happen in
	// practice; surfaced rather than silently colliding when an operator raises
	// MAX_WORKERS above the slot capacity.
	ErrNoFreeUID = herr.Code("no_free_worker_uid")

	// ErrSessionNotFound signals the worker's opencode internal session
	// vanished mid-turn. The orchestrator recycles the worker and surfaces a
	// typed "session-not-found" event.
	ErrSessionNotFound = herr.Code("opencode_session_not_found")

	// ErrWorkerSpawn signals a worker subprocess could not be created (home
	// setup, port allocation, process start).
	ErrWorkerSpawn = herr.Code("worker_spawn_failed")

	// ErrWorkerNotReady signals a freshly spawned worker's opencode did not
	// become ready within LANGY_READINESS_TIMEOUT_MS.
	ErrWorkerNotReady = herr.Code("worker_not_ready")

	// ErrOpenCodeAuthNotEnforced is the fail-closed guard verdict (ADR-033 Fix
	// A′): opencode answered an unauthenticated control request with something
	// other than 401, so the per-worker password is not gating the control
	// API. The worker must not serve traffic in that state.
	ErrOpenCodeAuthNotEnforced = herr.Code("opencode_auth_not_enforced")

	// ErrInternal is the generic fallback for unexpected errors.
	ErrInternal = herr.Code("internal_error")
)

// RegisterStatuses maps the HTTP-surface codes to statuses. Idempotent; called
// once when the router is built (mirrors aigateway's registerErrorStatuses).
func RegisterStatuses() {
	herr.RegisterStatus(ErrUnauthorized, http.StatusUnauthorized)
	herr.RegisterStatus(ErrBadRequest, http.StatusBadRequest)
	herr.RegisterStatus(ErrPayloadTooLarge, http.StatusRequestEntityTooLarge)
	herr.RegisterStatus(ErrInvalidConversationID, http.StatusBadRequest)
	herr.RegisterStatus(ErrConversationBusy, http.StatusConflict)
	herr.RegisterStatus(ErrMaxWorkers, http.StatusServiceUnavailable)
	herr.RegisterStatus(ErrNoFreeUID, http.StatusServiceUnavailable)
	herr.RegisterStatus(ErrSessionNotFound, http.StatusNotFound)
	herr.RegisterStatus(ErrWorkerSpawn, http.StatusInternalServerError)
	herr.RegisterStatus(ErrWorkerNotReady, http.StatusInternalServerError)
	herr.RegisterStatus(ErrOpenCodeAuthNotEnforced, http.StatusInternalServerError)
	herr.RegisterStatus(ErrInternal, http.StatusInternalServerError)
}
