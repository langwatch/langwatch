package apidiff

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The entitled pass. Six management-API operations (GET/POST /api/groups,
// GET/PATCH /api/organization, GET /api/organization/invites, GET
// /api/organization/members) were found answering 402
// enterprise_plan_required on the branch, because the seeded
// local-dev-organization resolves the self-hosted baseline plan rather than
// Enterprise. Stopping the comparison at that 402 tests only whether the two
// sides AGREE on the gate, never what either side does BEHIND it — so after
// the normal probe pass, every operation either side gated is re-probed with
// the organization entitled to an Enterprise plan, mid-run, no restart.
//
// Detection reads the handled-error envelope's `code` out of the body, never
// a hardcoded path list: a gate on a surface added tomorrow (SCIM, webhook
// endpoints already check assertEndpointsEntitled) is caught the same way
// this one was found.

// entitledCaseName is the probe case the entitled pass tags its transcripts
// and findings with, distinct from "read" or "mutation" — so a reader can
// tell "the gate answered differently" apart from "behavior BEHIND the gate
// answered differently" at a glance, and so the ledger can namespace its
// causes the same way (see RootCause in ledger.go).
const entitledCaseName = "entitled"

// enterprisePlanRequiredCode is the handled-error code both layouts' plan
// gate answers with (modules/organization/process's use of isEnterpriseTier
// on the branch; the equivalent self-hosted/SaaS gate on main).
const enterprisePlanRequiredCode = "enterprise_plan_required"

// entitledOrgID is the seeded organization every probe run authenticates as
// (see fixtures.go and boot.go's SCIM/permission fixtures).
const entitledOrgID = seededOrganizationID

// EntitlementActivator elevates entitledOrgID to an Enterprise plan on every
// instance a run is probing, mid-run, with no restart. Only `apidiff run`
// can supply one, on either path (buildEntitlementActivator). The plain
// `probe` subcommand (external instances, no database) and a deferred or
// disabled boot leave it nil, which the entitled pass reads as "nothing to
// activate" and skips outright, noted rather than silently doing nothing.
type EntitlementActivator func(ctx context.Context) error

// gateCode reads the handled-error code out of a JSON error envelope
// ({"error":{"code":"...", ...}}), or "" when the body carries none or is
// not that shape at all.
func gateCode(body string) string {
	decoded, ok := decodeJSONBody(body)
	if !ok {
		return ""
	}
	object, ok := decoded.(map[string]any)
	if !ok {
		return ""
	}
	errorObject, ok := object["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := errorObject["code"].(string)
	return code
}

// gatedBy reports whether a probe case's transcript hit the Enterprise gate
// on either side. Both layouts' error envelopes carry the code the same way,
// so one check serves both.
func gatedBy(transcript Transcript) bool {
	return gateCode(transcript.A.Body) == enterprisePlanRequiredCode || gateCode(transcript.B.Body) == enterprisePlanRequiredCode
}

// recordGate remembers an operation whose main-pass probe hit the Enterprise
// gate on either side, so the entitled pass knows what to re-probe. An
// operation missing from one side entirely is never recorded: that is
// already reported by missingOperationFinding, and re-probing it entitled
// would compare a request against no operation at all.
func (engine *probeEngine) recordGate(operation Operation, transcript Transcript) {
	if !gatedBy(transcript) {
		return
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if engine.gatedOps == nil {
		engine.gatedOps = map[string]Operation{}
	}
	engine.gatedOps[operationKeyOf(operation)] = operation
}

// sortedGatedOps returns the gated operations in the run's own deterministic
// order (path, then method).
func (engine *probeEngine) sortedGatedOps() []Operation {
	keys := make([]string, 0, len(engine.gatedOps))
	for key := range engine.gatedOps {
		keys = append(keys, key)
	}
	ops := make([]Operation, 0, len(keys))
	for _, key := range keys {
		ops = append(ops, engine.gatedOps[key])
	}
	sort.Slice(ops, func(i, j int) bool {
		if ops[i].Path != ops[j].Path {
			return ops[i].Path < ops[j].Path
		}
		return ops[i].Method < ops[j].Method
	})
	return ops
}

// entitledPass re-probes every operation the main pass saw the Enterprise
// gate refuse on EITHER side, now that entitledOrgID is entitled to an
// Enterprise plan. An operation neither side gated has nothing to test
// behind and is left alone entirely — it never appears in the report under
// the "entitled" case.
func (engine *probeEngine) entitledPass() []Finding {
	if len(engine.gatedOps) == 0 {
		return nil
	}
	ops := engine.sortedGatedOps()
	if engine.options.ActivateEntitlement == nil {
		engine.progress("entitled pass: skipped (%d operation(s) hit the Enterprise gate, but this run has no licence to activate: probe mode, or deferred or disabled at boot)\n", len(ops))
		return nil
	}
	engine.progress("entitled pass: activating %s's license for %d gated operation(s)\n", entitledOrgID, len(ops))
	if err := engine.options.ActivateEntitlement(engine.ctx); err != nil {
		return []Finding{{
			Kind:   FindingProbeFailed,
			Case:   entitledCaseName,
			Reason: "entitled pass: activation failed: " + err.Error(),
		}}
	}
	findings := make([]Finding, 0, len(ops))
	for index := range ops {
		findings = append(findings, engine.entitledProbe(ops[index])...)
	}
	return findings
}

// entitledProbe re-runs one gated operation with the owner's own
// credentials, now that the organization it belongs to is entitled, and
// compares the two sides exactly like the main pass would.
func (engine *probeEngine) entitledProbe(operation Operation) []Finding {
	target, ok := engine.ownerTarget(operation)
	if !ok {
		return nil
	}
	transcript := engine.runCase(operation, probeCase{name: entitledCaseName}, target)
	engine.transcripts = append(engine.transcripts, transcript)

	cmp := Comparison{Method: operation.Method, Path: operation.Path, Case: entitledCaseName, OperationID: operation.OperationID, ExactStatus: engine.options.ExactStatus}
	outcome := CompareResults(cmp, transcript.B, transcript.A)
	engine.suppressed.add(outcome.Suppressed)
	return outcome.Findings
}

// --- Activation: one licence, copied from the branch onto both databases ---
//
// Both layouts read the entitled organization's license off the same
// column, per request, with no cache in front of it:
//   - branch: enterprise/modules/licensing/process/src's
//     PrismaOrganizationLicenseRepository.tryReadLicense reads
//     Organization.license by id.
//   - main: platform/app/ee/licensing/licenseHandler.ts's readStoredLicense
//     reads the identical column, the identical way.
//
// So an UPDATE lands for the very next request on either side, with no
// restart. Both licence keys live in the root .env (LANGWATCH_LICENSE_PUBLIC_KEY
// and LANGWATCH_LICENSE_PRIVATE_KEY): both sides verify with the public key and
// the branch seed signs an ENTERPRISE licence with the private one. That stored
// licence is the one both databases get, since main's own seed writes one
// signed for another key. No licence stored means no keys: main's is cleared
// too, so an entitled main is never compared against an unentitled branch.

// licensePublicKeyEnv is the key both sides verify licences with.
const licensePublicKeyEnv = "LANGWATCH_LICENSE_PUBLIC_KEY"

// licensePublicKey is the invoking shell's value, else the root .env's, else
// "". The haven path needs neither: haven inherits the shell, and
// havenrun.CopyEnvFiles copies the root .env into both worktrees.
func licensePublicKey(branchDir string) string {
	if value := os.Getenv(licensePublicKeyEnv); value != "" {
		return value
	}
	values := map[string]string{}
	domain.ReadEnvFile(filepath.Join(branchDir, ".env"), values)
	return values[licensePublicKeyEnv]
}

// buildEntitlementActivator reads the licence the branch seed stored and
// writes it onto both sides at once, returning that write for the entitled
// pass to re-apply. No licence clears main's and defers the pass in one line;
// a failed read or write disables it without failing the run.
func (state *bootState) buildEntitlementActivator(ctx context.Context, booted *Booted) EntitlementActivator {
	licenseKey, err := state.sideSQL(ctx, booted.A, readSeededLicenseSQL())
	if err != nil {
		state.logf("entitled pass: disabled (read the branch seed's licence: %v)", err)
		return nil
	}
	if licenseKey == "" {
		if _, err := state.sideSQL(ctx, booted.B, clearEntitlementSQL()); err != nil {
			state.logf("entitled pass: disabled (clear main's licence: %v); main may be entitled while the branch is not", err)
			return nil
		}
		state.logf("entitled pass: deferred: no licence keys (%s and LANGWATCH_LICENSE_PRIVATE_KEY in the root .env), so neither side is entitled", licensePublicKeyEnv)
		return nil
	}
	sql := activateEntitlementSQL(licenseKey)
	activate := func(ctx context.Context) error {
		for _, instance := range []Instance{booted.A, booted.B} {
			if _, err := state.sideSQL(ctx, instance, sql); err != nil {
				return fmt.Errorf("activate entitlement %s: %w", instance.Name, err)
			}
		}
		return nil
	}
	if err := activate(ctx); err != nil {
		state.logf("entitled pass: disabled (%v)", err)
		return nil
	}
	return activate
}

// sideSQL runs one statement on a side's database: the run's own server on
// -no-haven, the stack's `haven db url` on the haven path (as visualdiff's
// edition.go does). The URL carries a password and is never logged.
func (state *bootState) sideSQL(ctx context.Context, instance Instance, sql string) (string, error) {
	if !state.cfg.UseHaven {
		return state.pgQueryDB(ctx, DatabaseName(state.runID, instance.Name), sql)
	}
	plan := state.havenPlanFor(instance)
	var address bytes.Buffer
	spec := commandSpec{name: havenCommand, args: []string{"db", "url"}, dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, &address); err != nil {
		return "", fmt.Errorf("haven db url %s: %w", instance.Name, err)
	}
	url := ""
	for _, field := range strings.Fields(address.String()) {
		if strings.HasPrefix(field, "postgres://") || strings.HasPrefix(field, "postgresql://") {
			url = field
			break
		}
	}
	if url == "" {
		return "", fmt.Errorf("haven db url %s answered no postgres address", instance.Name)
	}
	var output bytes.Buffer
	if err := state.run(ctx, commandSpec{name: "psql", args: []string{url, "-v", "ON_ERROR_STOP=1", "-tAc", sql}}, &output); err != nil {
		return "", fmt.Errorf("psql %s: %w", instance.Name, err)
	}
	return strings.TrimSpace(output.String()), nil
}

// readSeededLicenseSQL reads the licence the branch seed stored, "" when it
// stored none (no keys configured, or a private key that does not pair).
func readSeededLicenseSQL() string {
	return `SELECT coalesce("license", '') FROM "Organization" WHERE "id" = '` + entitledOrgID + `'`
}

// clearEntitlementSQL removes the seeded organization's licence.
func clearEntitlementSQL() string {
	return `UPDATE "Organization" SET "license" = NULL WHERE "id" = '` + entitledOrgID + `'`
}

// activateEntitlementSQL upserts the license directly onto the seeded
// organization's row. UPDATE rather than INSERT ON CONFLICT: the row always
// exists by the time a run activates anything — the seed itself creates it,
// before apidiff's own provisioning ever runs.
func activateEntitlementSQL(licenseKey string) string {
	return `UPDATE "Organization" SET "license" = '` + escapeSQLLiteral(licenseKey) + `' WHERE "id" = '` + entitledOrgID + `'`
}

// escapeSQLLiteral doubles single quotes for a SQL string literal. The
// license is base64 (no quotes ever appear in one), but a probe run should
// not depend on that holding forever.
func escapeSQLLiteral(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}
