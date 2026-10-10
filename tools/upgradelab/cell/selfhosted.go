package cell

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
)

// selfHostedNames are the report rows of the self-hosted install paths (plan section 8.3, E and U).
var selfHostedNames = map[string]string{
	"E1": "the license carries over: licensing:copy-organization-licenses settled and every licensed organization keeps its key",
	"E2": "SSO sign-in works before, during and after the switch",
	"E3": "SCIM pushed mid-upgrade lands once",
	"E4": "custom roles and grants behave as on main: a key with no grant is refused",
	"E5": "the seed account is a platform operator after the upgrade (ADMIN_EMAILS set, or the sole-organization bootstrap)",
	"U1": "the holding and upgrading pages are branded, centered and say what is happening (Haiku reads the shots)",
	"U2": "every command of docs/self-hosting/upgrade.mdx ran as written and exited 0",
	"U3": "Ops > Upgrades explains a held tenant and a failed step, and Retry fixes the failed one",
	"U4": "an operator can tell from the panel alone when it is safe to stop the old release (Haiku reads the shots)",
	"U5": "compose up with the new image needed no step the guide omits",
	"U6": "helm upgrade rolled with no unanswered probe",
}

// Kept apart from report.go while W3 owns it; fold these into invariantNames and scenarioIDs then.
func init() {
	maps.Copy(invariantNames, selfHostedNames)
	for id := range selfHostedNames {
		scenarioIDs[id] = []string{id}
	}
}

// TranscriptStep is one command of a self-hosted run: the guide's line it performs, what ran and how it ended.
type TranscriptStep struct {
	Phase     string `json:"phase"`
	Doc       string `json:"doc,omitempty"` // the guide's command, verbatim; empty for a harness step
	Command   string `json:"command"`
	Deviation string `json:"deviation,omitempty"`
	Exit      int    `json:"exit"`
	Ms        int64  `json:"ms"`
	Output    string `json:"output,omitempty"`
}

// SelfHostedRun is what a compose or helm run hands the judges.
type SelfHostedRun struct {
	Path        string // compose | helm
	Licensed    bool
	Transcript  []TranscriptStep
	Phases      []PhaseChange // the probe's phases from the guide's upgrade command on
	Shots       []Shot
	Ledger      []LedgerRow
	LicenseLost int // licensed organizations without a license key after the upgrade; -1 unread
}

// JudgeSelfHosted is every E and U row for one run; what only a later stream or Haiku can judge is inconclusive, never a pass.
func JudgeSelfHosted(run SelfHostedRun) []Verdict {
	var verdicts []Verdict
	if run.Licensed {
		verdicts = append(verdicts, judgeLicense(run))
	}
	pending := func(id, why string) Verdict {
		return Verdict{ID: id, Name: invariantNames[id], Result: "inconclusive", Detail: why}
	}
	verdicts = append(verdicts,
		pending("E2", "no SSO stream in the self-hosted run yet"),
		pending("E3", "no SCIM stream in the self-hosted run yet"),
		pending("E4", "no grants flow in the self-hosted run yet"),
		judgeOperator(run.Shots),
		pending("U1", "for Haiku: "+shotFiles(run.Shots, "holding", "signin")),
		judgeGuide(run.Transcript),
		pending("U3", "judged by D3 and the round 3 overlays"),
		pending("U4", "for Haiku: "+shotFiles(run.Shots, "upgrades")))
	if run.Path == "compose" {
		verdicts = append(verdicts, judgeNoOmittedStep(run.Transcript))
	}
	if run.Path == "helm" {
		verdicts = append(verdicts, judgeRolled(run.Phases))
	}
	return verdicts
}

func judgeLicense(run SelfHostedRun) Verdict {
	index := slices.IndexFunc(run.Ledger, func(row LedgerRow) bool { return row.ID == "licensing:copy-organization-licenses" })
	switch {
	case index < 0:
		return verdict("E1", false, "licensing:copy-organization-licenses is not in the ledger")
	case run.LicenseLost < 0:
		return Verdict{ID: "E1", Name: invariantNames["E1"], Result: "inconclusive", Detail: "licenses not read"}
	}
	status := run.Ledger[index].Status
	return verdict("E1", (status == "done" || status == "not-needed") && run.LicenseLost == 0,
		fmt.Sprintf("step %s; %d licensed organizations without a key", status, run.LicenseLost))
}

func judgeOperator(shots []Shot) Verdict {
	for _, shot := range shots {
		if shot.Phase == "settled" && strings.HasSuffix(shot.File, "-upgrades.png") {
			return verdict("E5", OpsState(shot.State) != "", fmt.Sprintf("settled Ops > Upgrades shows %q", shot.State))
		}
	}
	return verdict("E5", false, "no settled Ops > Upgrades shot")
}

func judgeGuide(transcript []TranscriptStep) Verdict {
	var wrong []string
	ran := 0
	for _, step := range transcript {
		if step.Doc == "" {
			continue
		}
		ran++
		if step.Exit != 0 || step.Deviation != "" {
			wrong = append(wrong, fmt.Sprintf("%q exit %d %s", step.Doc, step.Exit, step.Deviation))
		}
	}
	if ran == 0 {
		return verdict("U2", false, "no command of the guide ran")
	}
	return verdict("U2", len(wrong) == 0, strconv.Itoa(ran)+" guide commands; "+strings.Join(wrong, "; "))
}

// judgeNoOmittedStep: between the guide's first upgrade command and settle, nothing but the guide ran.
func judgeNoOmittedStep(transcript []TranscriptStep) Verdict {
	var extra []string
	for _, step := range transcript {
		if step.Phase == "upgrade" && step.Doc == "" {
			extra = append(extra, step.Command)
		}
	}
	return verdict("U5", len(extra) == 0, "steps the guide omits: "+strings.Join(extra, "; "))
}

func judgeRolled(phases []PhaseChange) Verdict {
	var down []string
	for _, change := range phases {
		if change.Phase == "down" {
			down = append(down, strconv.FormatInt(change.AtMs, 10))
		}
	}
	if len(phases) == 0 {
		return verdict("U6", false, "no probe ran during helm upgrade")
	}
	return verdict("U6", len(down) == 0, "unanswered from ms: "+strings.Join(down, ", "))
}

func shotFiles(shots []Shot, pages ...string) string {
	var files []string
	for _, shot := range shots {
		if slices.ContainsFunc(pages, func(page string) bool { return strings.HasSuffix(shot.File, "-"+page+".png") }) {
			files = append(files, shot.File)
		}
	}
	if len(files) == 0 {
		return "no shot taken"
	}
	return strings.Join(files, ", ")
}

// LedgerAt reads every step row from <schema>_upgrade_ledger; Ledger reads the cell's mydb one.
func LedgerAt(ctx context.Context, databaseURL, schema string) ([]LedgerRow, error) {
	out, err := psql(ctx, databaseURL, `SELECT coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'mode', mode, 'status', status, 'attempt', attempt, 'finished_at', finished_at::text, 'started_at', started_at::text) ORDER BY id), '[]') FROM `+schema+`_upgrade_ledger._langwatch_upgrade_step`)
	if err != nil {
		return nil, err
	}
	var rows []LedgerRow
	err = json.Unmarshal([]byte(out), &rows)
	return rows, err
}

// LicensesLost counts organizations main held a license for that have no OrganizationLicense key now.
func LicensesLost(ctx context.Context, databaseURL, schema string) (int, error) {
	out, err := psql(ctx, databaseURL, fmt.Sprintf(`SELECT count(*) FROM %[1]s."Organization" o WHERE o.license IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %[1]s."OrganizationLicense" l WHERE l."organizationId" = o.id AND l."licenseKey" IS NOT NULL)`, schema))
	if err != nil {
		return -1, err
	}
	return strconv.Atoi(strings.TrimSpace(out))
}
