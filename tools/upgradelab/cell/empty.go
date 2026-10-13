package cell

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// EmptyShape is a fresh install of the from release: no seed, no traffic (plan §7.1 `empty`, run R2-empty).
const EmptyShape = "empty"

func (cell *run) emptyOrigin() bool { return cell.options.Shape == EmptyShape }

// emptySteps is the empty cell: main makes its schema on blank stores, head boots on them and upgrades.
func (cell *run) emptySteps() []step {
	return []step{{"build", cell.buildBoth}, {"stores", cell.freshStores}, {"from-schema", cell.fromSchema}, {"from-up", cell.fromUp},
		{"observe", cell.observeOnly}, {"cut", cell.cut}, {"switch", cell.switchToHead}, {"ready", cell.awaitReady},
		{"settle", cell.settle}, {"checks", func(ctx context.Context) error {
			cell.stopObservers()
			return cell.emptyChecks(ctx)
		}}}
}

// observeOnly starts the samplers without traffic: an empty install has no project to send it to.
func (cell *run) observeOnly(ctx context.Context) error {
	samplerCtx, stopSampler := context.WithCancel(context.WithoutCancel(ctx))
	cell.stopSampler = stopSampler
	go cell.sampleQueue(samplerCtx)
	cell.startObservers(ctx)
	cell.mark("trafficStart")
	return nil
}

// emptyAccount writes the seed account once head is ready, so the stores stay empty through the upgrade.
func (cell *run) emptyAccount(ctx context.Context) {
	if err := psqlFile(ctx, cell.stores.psqlURL(), generate.AccountSQL(cell.options.Seed)); err != nil {
		cell.report.Notes = append(cell.report.Notes, "seed account after ready: "+err.Error())
	}
	email, password := generate.SeedAccount(cell.options.Seed)
	cell.seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: password, Label: cell.options.Name()})
	cell.seeder.PlainWire = true
	if err := cell.emptyOrganization(ctx); err != nil {
		cell.report.Notes = append(cell.report.Notes, "organization for the seed account after ready (O1 needs one): "+err.Error())
		return
	}
	if cell.options.Shots { // the account and its organization exist only now, so the walk (B1) starts here
		cell.walker, _ = StartWalker(ctx, WalkSpec{Dir: filepath.Join(cell.options.HeadDir, "apps", "ui"), RunDir: cell.options.RunDir,
			URL: cell.url(), Email: email, Password: password, Origin: cell.origin, Every: cell.options.WalkEvery})
	}
}

// emptyOrganization gives the seed account an organization through head's own sign-up door (T0-F9),
// so O1's shot reaches Ops > Upgrades instead of /onboarding/welcome.
func (cell *run) emptyOrganization(ctx context.Context) error {
	if err := cell.seeder.SignIn(ctx); err != nil {
		return err
	}
	label := "Upgradelab " + cell.options.Name()
	cell.emptyOrg.Called = true
	return cell.seeder.Call(ctx, true, "onboarding.initializeOrganization", map[string]any{"orgName": label, "projectName": label}, &cell.emptyOrg)
}

// emptyOrgAnswer is head's sign-up answer; grantsConfirmed is false while the founder's grants still land (T0-F11).
type emptyOrgAnswer struct {
	Called          bool   `json:"-"`
	OrganizationID  string `json:"organizationId"`
	GrantsConfirmed *bool  `json:"grantsConfirmed"`
}

// emptyOrgVerdict (F3, T0-F11): after settle the organization still stands, the founder is its member and holds bindings.
func (cell *run) emptyOrgVerdict(ctx context.Context) Verdict {
	answer := cell.emptyOrg
	if !answer.Called || answer.OrganizationID == "" {
		return verdict("F3", false, fmt.Sprintf("no organization made after ready (called %v)", answer.Called))
	}
	confirmed := "absent"
	if answer.GrantsConfirmed != nil {
		confirmed = fmt.Sprint(*answer.GrantsConfirmed)
	}
	email, _ := generate.SeedAccount(cell.options.Seed)
	id := strings.ReplaceAll(answer.OrganizationID, "'", "")
	rows, err := cell.legacyOrgStanding(ctx, `SELECT 'org:' || count(*) FROM mydb."Organization" WHERE id = '`+id+`'
UNION ALL SELECT 'member:' || coalesce(string_agg(ou.role::text, ','), '-') FROM mydb."OrganizationUser" ou JOIN mydb."User" u ON u.id = ou."userId" WHERE ou."organizationId" = '`+id+`' AND u.email = '`+email+`'
UNION ALL SELECT 'bindings:' || count(*) FROM mydb."RoleBinding" b JOIN mydb."User" u ON u.id = b."userId" WHERE b."organizationId" = '`+id+`' AND u.email = '`+email+`'`)
	if err != nil {
		return verdict("F3", false, "standing read: "+err.Error())
	}
	detail := fmt.Sprintf("organization %s, grantsConfirmed %s in the answer; after settle %v", answer.OrganizationID, confirmed, rows)
	stands := len(rows) == 3 && rows[0] == "org:1" && rows[1] != "member:-" && rows[2] != "bindings:0"
	return verdict("F3", stands, detail)
}

func (cell *run) emptyChecks(ctx context.Context) error {
	cell.report.Marks, cell.report.Phases = cell.marks, cell.poller.Timeline()
	final, err := Ledger(ctx, cell.stores)
	if err != nil {
		return err
	}
	cell.report.Queue = cell.queueSummary(ctx)
	cell.report.Verdicts = append(cell.report.Verdicts,
		cell.holdingVerdict(), ledgerVerdict(final), notNeededVerdict(final), reopenedVerdict(cell.atReady, final, cell.drills.retried), cell.rosterVerdict(ctx),
		cell.copyVerdict(ctx), cell.secondRunVerdict(ctx, final), cell.logVerdict(), cell.apiEarlyVerdict(), cell.crashVerdict(),
		queueVerdict(cell.report.Queue), cell.opsVerdict(final), cell.storedEventsVerdict(ctx), cell.emptyOrgVerdict(ctx), cell.browserVerdict())
	cell.report.Verdicts = append(cell.report.Verdicts, cell.signupVerdicts(ctx)...)
	for index := range cell.report.Verdicts {
		cell.report.Verdicts[index].Scenarios = scenarioIDs[cell.report.Verdicts[index].ID]
	}
	cell.report.Resources, _ = ResourcePeaks(filepath.Join(cell.options.RunDir, "resources.jsonl"))
	cell.report.Ribbon = Ribbon(cell.report, cell.origin, final)
	return nil
}

// notNeededVerdict (F1, Alex's T0-F2 ruling): main made the schema, so a data step over empty stores ends done
// having touched zero rows (not-needed also passes); any row count its report names must be zero.
func notNeededVerdict(rows []LedgerRow) Verdict {
	var wrong []string
	data := 0
	for i := range rows {
		row := &rows[i]
		if strings.HasSuffix(row.Kind, "-schema") || row.Kind == "seed" || row.Mode == "operator" {
			continue
		}
		data++
		switch touched := rowsTouched(row.Report); {
		case row.Status != "done" && row.Status != "not-needed":
			wrong = append(wrong, row.ID+"="+row.Status)
		case len(touched) > 0:
			wrong = append(wrong, row.ID+" touched "+strings.Join(touched, ", "))
		}
	}
	return Verdict{ID: "F1", Name: invariantNames["F1"], Result: map[bool]string{true: "pass", false: "fail"}[len(wrong) == 0],
		Detail: fmt.Sprintf("%d data steps; not done over zero rows: %v", data, wrong)}
}

// rowCountKey is a report key that counts rows a step changed.
var rowCountKey = regexp.MustCompile(`(?i)rows|processed|migrated|updated|copied|moved|touched|written|rewritten|backfilled`)

// rowsTouched lists the non-zero row counts anywhere in a step's report, as key=value.
func rowsTouched(report json.RawMessage) []string {
	var tree any
	if len(report) == 0 || json.Unmarshal(report, &tree) != nil {
		return nil
	}
	var touched []string
	var walk func(key string, node any)
	walk = func(key string, node any) {
		switch value := node.(type) {
		case map[string]any:
			for child, each := range value {
				walk(child, each)
			}
		case []any:
			for _, each := range value {
				walk(key, each)
			}
		case float64:
			if value != 0 && rowCountKey.MatchString(key) {
				touched = append(touched, fmt.Sprintf("%s=%v", key, value))
			}
		}
	}
	walk("", tree)
	slices.Sort(touched)
	return touched
}
