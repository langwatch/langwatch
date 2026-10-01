package apidiff

import (
	"fmt"
	"net/http"
	"strings"
)

// A run compares two instances by presenting the same credentials to both. If
// a credential dies mid-run, every later probe answers 401 on that side — and
// when it dies on both sides, the two sides AGREE and the difference vanishes
// from the report as though it had been fixed. Run 8 lost seventeen
// differences exactly that way and read as progress.
//
// self-protection.go stops the known cause. This file is the assertion that
// catches the whole class: every credential is read once before the first
// probe and once after the last one, and a credential that stopped
// authenticating fails the run by name. It is the cheap version of the rule —
// a disappeared difference must never be indistinguishable from a fixed one.

// CredentialCheck is one credential's authentication reading, taken before the
// first probe and again after the last one. Before and After are [base,
// candidate] status codes, the same order every other pair in the report uses.
type CredentialCheck struct {
	Label     string `json:"label"`
	Operation string `json:"operation,omitempty"`
	Before    [2]int `json:"before"`
	After     [2]int `json:"after"`
	// Lost is the finding this file exists for: the credential authenticated
	// at the start of the run and no longer does.
	Lost bool `json:"lost"`
	// NeverAuthenticated says the credential was already refused before the
	// first probe, so every comparison it fed is worthless too — a different
	// failure with the same consequence.
	NeverAuthenticated bool `json:"neverAuthenticated"`
	// Unverifiable says the union documents no operation this run could read
	// the credential with, so the run cannot tell whether it survived. Named
	// rather than assumed healthy.
	Unverifiable bool   `json:"unverifiable"`
	Note         string `json:"note,omitempty"`
}

// Healthy reports whether this reading raises no doubt about the run.
func (check CredentialCheck) Healthy() bool {
	return !check.Lost && !check.NeverAuthenticated && !check.Unverifiable
}

// credentialCanary is one credential and the operation the run re-reads it
// with: the cheapest proof the credential still authenticates.
type credentialCanary struct {
	label     string
	headers   map[string]string
	operation Operation
	found     bool
}

// namedCredential is one credential the run probes with, identified by the
// header its scheme puts it in.
type namedCredential struct {
	label  string
	header string
	value  string
}

// probedCredentials lists the credentials whose death would blind the run.
// The admin and SCIM keys are provisioned rather than seeded and no operation
// can revoke them from inside a probe, so they are not read here.
func probedCredentials(keys Keys) []namedCredential {
	credentials := make([]namedCredential, 0, 4)
	add := func(label, header, value string) {
		if value != "" {
			credentials = append(credentials, namedCredential{label: label, header: header, value: value})
		}
	}
	add("project key", "X-Auth-Token", keys.ProjectKey)
	if keys.OrgKey != "" {
		add("organization key", "Authorization", "Bearer "+keys.OrgKey)
	}
	add("permission-probe key-b", "X-Auth-Token", keys.ProjectKeyB)
	add("permission-probe key-c", "X-Auth-Token", keys.ProjectKeyC)
	return credentials
}

// credentialCanaries picks, for each credential, the cheapest operation that
// proves it still authenticates: a read both sides document, with nothing to
// resolve, whose OWN security scheme resolves to that credential. Reading the
// credential through the surface's own auth is the point — a bespoke endpoint
// would prove the endpoint works, not the credential.
//
// The foreign permission-probe keys have no operation of their own, so they
// borrow the project key's canary with their own header value: the same read,
// a different credential.
func (engine *probeEngine) credentialCanaries(operations []Operation) []credentialCanary {
	ownerCanary, ownerFound := engine.canaryOperation(operations, "X-Auth-Token", engine.options.Keys.ProjectKey)
	canaries := make([]credentialCanary, 0, 4)
	for _, credential := range probedCredentials(engine.options.Keys) {
		operation, found := engine.canaryOperation(operations, credential.header, credential.value)
		if !found && credential.header == "X-Auth-Token" {
			operation, found = ownerCanary, ownerFound
		}
		canaries = append(canaries, credentialCanary{
			label:     credential.label,
			headers:   map[string]string{credential.header: credential.value},
			operation: operation,
			found:     found,
		})
	}
	return canaries
}

// canaryOperation finds the first parameterless read both sides document whose
// resolved auth header carries the given credential value.
func (engine *probeEngine) canaryOperation(operations []Operation, header, value string) (Operation, bool) {
	for index := range operations {
		operation := operations[index]
		if !isReadMethod(operation.Method) || !operation.InA || !operation.InB || hasParametersToResolve(operation) {
			continue
		}
		if authHeaders(operation, engine.options.Schemes, engine.options.Keys)[header] == value {
			return operation, true
		}
	}
	return Operation{}, false
}

// hasParametersToResolve reports whether probing this operation would need a
// path or required-query value the canary read has no business minting.
func hasParametersToResolve(operation Operation) bool {
	for _, param := range operation.Params {
		if param.In == "path" || (param.In == "query" && param.Required) {
			return true
		}
	}
	return false
}

// readCanaries reads every canary once, returning [base, candidate] statuses
// per canary in the canaries' own order.
func (engine *probeEngine) readCanaries(canaries []credentialCanary) [][2]int {
	readings := make([][2]int, len(canaries))
	for index := range canaries {
		if !canaries[index].found {
			continue
		}
		readings[index] = engine.readCanary(canaries[index])
	}
	return readings
}

// readCanary issues the canary read on both sides and returns their statuses
// as [base, candidate].
func (engine *probeEngine) readCanary(canary credentialCanary) [2]int {
	pathA, pathB := canary.operation.SidePaths()
	request := probeRequest{method: canary.operation.Method, headers: canary.headers}
	request.baseURL, request.path = engine.options.A, pathA
	candidate := engine.execute(request)
	request.baseURL, request.path = engine.options.B, pathB
	base := engine.execute(request)
	return [2]int{base.Status, candidate.Status}
}

// buildCredentialChecks folds the two readings into one verdict per
// credential.
func buildCredentialChecks(canaries []credentialCanary, before, after [][2]int) []CredentialCheck {
	checks := make([]CredentialCheck, 0, len(canaries))
	for index := range canaries {
		checks = append(checks, credentialCheckOf(canaries[index], before[index], after[index]))
	}
	return checks
}

// credentialCheckOf classifies one credential's pair of readings.
func credentialCheckOf(canary credentialCanary, before, after [2]int) CredentialCheck {
	check := CredentialCheck{Label: canary.label, Before: before, After: after}
	if !canary.found {
		check.Unverifiable = true
		check.Note = "the operation union documents no parameterless read this credential authenticates, " +
			"so the run cannot tell whether it survived; a probe that revoked it would look like agreement"
		return check
	}
	check.Operation = canary.operation.Method + " " + canary.operation.Path
	if sides := refusedSides(before); len(sides) > 0 {
		check.NeverAuthenticated = true
		check.Note = "already refused on the " + strings.Join(sides, " and ") +
			" before the first probe, so every comparison it fed compared two refusals rather than two behaviors"
		return check
	}
	lost := refusedSides(after)
	if len(lost) == 0 {
		return check
	}
	check.Lost = true
	check.Note = fmt.Sprintf("authenticated before the run and is refused after it on the %s (%s): "+
		"every probe needing it after the moment it died answered 401 regardless of behavior, "+
		"so agreement between the sides from that point on means nothing",
		strings.Join(lost, " and "), statusPairText(before, after))
	return check
}

// refusedSides names the sides that answered 401 to the canary read.
func refusedSides(reading [2]int) []string {
	sides := make([]string, 0, 2)
	if reading[0] == http.StatusUnauthorized {
		sides = append(sides, "base")
	}
	if reading[1] == http.StatusUnauthorized {
		sides = append(sides, "candidate")
	}
	return sides
}

// statusPairText renders the before/after readings for the note.
func statusPairText(before, after [2]int) string {
	return fmt.Sprintf("base %d -> %d, candidate %d -> %d", before[0], after[0], before[1], after[1])
}

// LostCredentials returns the checks that invalidate the run: a credential
// that died mid-run, or one that never worked at all. An unverifiable reading
// is reported but does not invalidate anything on its own.
func (report Report) LostCredentials() []CredentialCheck {
	lost := make([]CredentialCheck, 0)
	for _, check := range report.CredentialChecks {
		if check.Lost || check.NeverAuthenticated {
			lost = append(lost, check)
		}
	}
	return lost
}
