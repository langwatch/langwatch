package apidiff

import "strings"

// The improved-error acceptance. The standing triage rule — a branch answer
// that is a strictly BETTER error than main's is not drift to chase, it is
// the fix already landed — is encoded here rather than left as something a
// human re-derives from the report every run. Exactly one direction
// qualifies: main answers with an error the platform does not attribute to
// any particular cause (a 5xx, or a body carrying the generic placeholder
// code below, at any status), and the branch answers with a HANDLED 4xx
// carrying its own stable code — a 422 with field reasons, a named 4xx
// refusal, anything a caller can branch on. Every other direction of drift —
// most of all the reverse, a main 4xx degrading to a branch 5xx — is left to
// fail exactly as it always has; this file grants no other exemption.
//
// Ambiguity resolves to NOT improved: an unparsable or codeless body on
// either side never qualifies. See classifyImprovedError.

// genericErrorCode is the code both envelope shapes carry for a failure the
// platform cannot name: apps/api/src/app/api-canonical-error.ts's
// handledErrorEnvelope forces this code onto EVERY 5xx it emits (even a
// HandledError's own code is discarded at 5xx), and
// packages/api/src/errors.ts's internalErrorResponse uses the identical
// string for its own unnamed-failure path. A body reporting this code, at
// any status, is the shape a candidate improves FROM, never the "stable
// machine-readable code" a candidate must improve TO.
const genericErrorCode = "internal_error"

// improvedErrorCausePrefix is the un-namespaced root-cause prefix every
// improved-error finding's cause carries (see RootCause in ledger.go for the
// "entitled:" namespacing on top of it). Cause names are
// "error-improved:<before-status>-<after-status>".
const improvedErrorCausePrefix = "error-improved"

// isPlatformOwnedFailure reports whether one side's answer is the failure
// this rule may accept an improvement away from. Status alone is enough — a
// 5xx is unowned by construction, whatever its body happens to say — so an
// unparsable 5xx body still qualifies; the body check only widens the net to
// a generic-coded body reported at some other status.
func isPlatformOwnedFailure(side SideResult) bool {
	if side.Status >= 500 && side.Status < 600 {
		return true
	}
	return responseCode(side.Body) == genericErrorCode
}

// isImprovedHandledError reports whether one side's answer is a handled
// refusal at least as good as the platform-owned failure it would replace:
// a 4xx carrying its own stable code, not the generic placeholder. code is
// returned for the finding's fields when ok.
func isImprovedHandledError(side SideResult) (code string, ok bool) {
	if side.Status < 400 || side.Status >= 500 {
		return "", false
	}
	code = responseCode(side.Body)
	if code == "" || code == genericErrorCode {
		return "", false
	}
	return code, true
}

// responseCode reads a stable machine code off a captured body, in either
// envelope shape apidiff probes: the REST wrapper
// (`{"error":{"code":...}}`, packages/api/src/rest/response.ts's
// apiErrorBody) or the flat shape (`{"code":...}`,
// packages/api/src/errors.ts's ErrorResponseBody). Empty when the body is
// not JSON, is JSON with neither shape, or carries no code at all — the
// fail-closed case every caller here treats as "not improved".
func responseCode(body string) string {
	decoded, ok := decodeJSONBody(body)
	if !ok {
		return ""
	}
	object, ok := decoded.(map[string]any)
	if !ok {
		return ""
	}
	if code, ok := object["code"].(string); ok && code != "" {
		return code
	}
	if errorObject, ok := object["error"].(map[string]any); ok {
		if code, ok := errorObject["code"].(string); ok {
			return code
		}
	}
	return ""
}

// classifyImprovedError reports the improved-error finding for one status
// pair whose classes already differ, or ok=false when the pair does not
// qualify for the acceptance — the caller falls back to the ordinary
// status_diff finding in that case. Only called from compareStatus, and
// only when before and after already sit in different status classes.
func classifyImprovedError(cmp Comparison, before, after SideResult) (Finding, bool) {
	if !isPlatformOwnedFailure(before) {
		return Finding{}, false
	}
	code, ok := isImprovedHandledError(after)
	if !ok {
		return Finding{}, false
	}
	return cmp.finding(FindingErrorImproved, map[string][2]any{
		"status": {before.Status, after.Status},
		"code":   {"", code},
	}), true
}

// isAcceptedImprovement reports whether a root-cause slug is the always-
// accepted improved-error direction — exempt from ever needing a
// -ledger-baseline entry, whether it came from the main pass or (with the
// "entitled:" namespace RootCause adds) the entitled pass.
func isAcceptedImprovement(cause string) bool {
	return strings.HasPrefix(strings.TrimPrefix(cause, "entitled:"), improvedErrorCausePrefix)
}
