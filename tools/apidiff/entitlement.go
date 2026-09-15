package apidiff

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
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
// gate answers with (modules/organization/server's use of isEnterpriseTier
// on the branch; the equivalent self-hosted/SaaS gate on main).
const enterprisePlanRequiredCode = "enterprise_plan_required"

// entitledOrgID is the seeded organization every probe run authenticates as
// (see fixtures.go and boot.go's SCIM/permission fixtures).
const entitledOrgID = seededOrganizationID

// EntitlementActivator elevates entitledOrgID to an Enterprise plan on every
// instance a run is probing, mid-run, with no restart. Only `apidiff run`
// can supply one — it alone owns the databases. The plain `probe` subcommand
// (external instances, no database) and the haven path (a stack's database
// belongs to haven, exactly like the SCIM and permission-probe fixtures)
// leave it nil, which the entitled pass reads as "nothing to activate" and
// skips outright, noted rather than silently doing nothing.
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
		engine.progress("entitled pass: skipped (%d operation(s) hit the Enterprise gate, but this run owns no database to activate a license on)\n", len(ops))
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

// --- Activation: reading and applying the local-dev Enterprise license ---
//
// Both layouts read the entitled organization's license off the same
// column, per request, with no cache in front of it:
//   - branch: enterprise/modules/licensing/server/src's
//     PrismaOrganizationLicenseRepository.tryReadLicense reads
//     Organization.license by id.
//   - main: platform/app/ee/licensing/licenseHandler.ts's readStoredLicense
//     reads the identical column, the identical way.
//
// So an UPDATE lands for the very next request on either side — no restart,
// no boot-time env var. Verified NOT to flip apps/api's own answer today:
// see this package's README ("Entitled pass") and the lane handoff for why.

// localDevLicenseSeedPath is where the checkout's own seed keeps the
// pre-signed ENTERPRISE license it activates for entitledOrgID
// (packages/prisma-client/prisma/seed.ts -> resolveSeedLicense). Main's own
// mirror (platform/app/scripts/localDevLicense.ts) carries the identical
// string — verified byte-for-byte when this pass was written — so reading it
// once from the branch checkout is enough to activate BOTH sides' databases.
const localDevLicenseSeedPath = "enterprise/modules/licensing/server/src/seeding.ts"

// localDevLicenseKeyPattern extracts LOCAL_DEV_ENTERPRISE_LICENSE_KEY's
// quoted value. Copying the constant's VALUE into Go would silently go
// stale the day somebody rotates it; reading the source file keeps this
// pass bound to whatever the seed itself activates. A rename or reshape of
// the export fails this pattern rather than quietly entitling nothing — see
// entitlement_test.go's assertion against the real file.
var localDevLicenseKeyPattern = regexp.MustCompile(`LOCAL_DEV_ENTERPRISE_LICENSE_KEY\s*=\s*\n?\s*"([^"]+)"`)

// readLocalDevEnterpriseLicenseKey reads the license the entitled pass
// activates, from the branch checkout's own seeding source.
func readLocalDevEnterpriseLicenseKey(branchDir string) (string, error) {
	path := filepath.Join(branchDir, localDevLicenseSeedPath)
	// #nosec G304 -- path is branchDir (this run's own checkout, resolved by
	// Boot) joined onto a fixed package constant, never user input.
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read local-dev enterprise license: %w", err)
	}
	match := localDevLicenseKeyPattern.FindSubmatch(data)
	if match == nil {
		return "", fmt.Errorf("read local-dev enterprise license: %s no longer declares LOCAL_DEV_ENTERPRISE_LICENSE_KEY in the expected shape", path)
	}
	return string(match[1]), nil
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
