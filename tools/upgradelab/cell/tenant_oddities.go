package cell

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
)

// OverlayTenantOddities plants awkward tenant data on main (trial T8, ledger UM-23): a held organization, plaintext
// provider keys, dataset rows in Postgres and an organization with prompts but no tags. It needs an SSO profile:
// the held organization's legacy domain is the one a second organization's own connection proved on main.
const OverlayTenantOddities = "tenant-oddities"

const (
	oddPlaintextKey  = "upgradelab-fake-plaintext-key-1" // a fake, never a provider-key shape
	oddDataset       = "upgradelab-postgres-rows"
	oddPrompt        = "upgradelab-untagged-prompt"
	oddHeldProvider  = "samlp|upgradelab-held"
	actionNeededCard = "Action needed for updates"
	// secretHealStep ends every drifted user "migrated" by design (never finalized), so it is no held organization.
	secretHealStep = "identity-d01-secret-heal"
)

var oddDatasetMarkers = []string{"odd-row-alpha", "odd-row-bravo", "odd-row-charlie"}

// oddSeed is what the overlay planted on main and read there before the cut.
type oddSeed struct {
	held, keys, untagged madeOrganization
	keysAPIKey, tagsKey  string // the projects' own API keys, kept in memory only
	providerID           string
	before               oddFacts
	err                  error
}

// oddFacts is one reading of the planted rows: before the cut on main, after settle on head.
type oddFacts struct {
	KeysForm      string // jsonb_typeof of the provider's customKeys: object is plaintext
	DatasetRows   int    // DatasetRecord rows of the planted dataset in Postgres
	UntaggedTags  int    // PromptTag rows of the untagged organization
	HeldStates    []string
	OtherHeld     []string // other organizations held or parked by the same step
	ProvidersRead int      // head's GET /api/model-providers status for the keys project
	ProvidersBody string
	DatasetRead   int
	DatasetBody   string
	PromptRead    int
	OpsText       string
	OpsErr        error
	HomeText      string
	HomeErr       error
	ReadErr       error
}

// plantOddities makes three organizations through main's onboarding door and plants each oddity as main can hold it.
func (cell *run) plantOddities(ctx context.Context) error {
	odd := &cell.odd
	for _, plant := range []func(context.Context) error{cell.plantHeld, cell.plantKeysOrganization, cell.plantUntagged} {
		if odd.err = plant(ctx); odd.err != nil {
			return odd.err
		}
	}
	odd.before = cell.readOddFacts(ctx, false)
	if odd.err = odd.before.ReadErr; odd.err != nil {
		return odd.err
	}
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("tenant oddities: held %s (ssoDomain %s, a domain organization SAML's connection proved), plaintext keys and Postgres dataset in %s, untagged prompts in %s; before: %+v",
		odd.held.org, samlDomain, odd.keys.org, odd.untagged.org, oddSummary(odd.before)))
	return nil
}

// plantHeld pins, by staff SQL (main's only way to set the legacy columns), a domain the SAML organization's connection proved.
func (cell *run) plantHeld(ctx context.Context) error {
	made, err := cell.newOrganization(ctx, "Held tenant "+cell.options.Name())
	if err != nil {
		return fmt.Errorf("held organization: %w", err)
	}
	cell.odd.held = made
	if _, err := cell.orgSQLFor(ctx, made.org, `UPDATE mydb."Organization" SET "ssoDomain" = '`+samlDomain+`', "ssoProvider" = '`+oddHeldProvider+`' WHERE id = %s`); err != nil {
		return fmt.Errorf("held organization legacy columns: %w", err)
	}
	return nil
}

func (cell *run) plantKeysOrganization(ctx context.Context) error {
	made, err := cell.newOrganization(ctx, "Plaintext keys "+cell.options.Name())
	if err != nil {
		return fmt.Errorf("keys organization: %w", err)
	}
	cell.odd.keys = made
	if cell.odd.keysAPIKey, err = cell.projectKey(ctx, made.project); err != nil {
		return err
	}
	if err := cell.plantPlaintextKeys(ctx); err != nil {
		return err
	}
	return cell.plantDatasetRows(ctx)
}

// plantUntagged makes an organization as one made before main seeded tags at creation (none), then a prompt in it.
func (cell *run) plantUntagged(ctx context.Context) error {
	made, err := cell.newOrganization(ctx, "Untagged prompts "+cell.options.Name())
	if err != nil {
		return fmt.Errorf("untagged organization: %w", err)
	}
	cell.odd.untagged = made
	if cell.odd.tagsKey, err = cell.projectKey(ctx, made.project); err != nil {
		return err
	}
	if _, err := cell.orgSQLFor(ctx, made.org, `DELETE FROM mydb."PromptTag" WHERE "organizationId" = %s`); err != nil {
		return fmt.Errorf("untagged organization tags: %w", err)
	}
	status, body, err := cell.oddPostMain(ctx, oddCall{key: cell.odd.tagsKey, path: "/api/prompts", body: map[string]any{"handle": oddPrompt, "prompt": "untagged", "model": "openai/gpt-5"}})
	if err != nil {
		return fmt.Errorf("untagged prompt on main: %w", err)
	}
	if status >= 300 {
		return fmt.Errorf("untagged prompt on main: %d %s", status, body)
	}
	return nil
}

// plantPlaintextKeys writes a provider row as a release before key encryption left it; main still reads that form.
func (cell *run) plantPlaintextKeys(ctx context.Context) error {
	odd := &cell.odd
	odd.providerID = "mp_upgradelab_plaintext_" + strings.ToLower(odd.keys.org[len(odd.keys.org)-8:])
	statement := `INSERT INTO mydb."ModelProvider" (id, name, provider, enabled, "customKeys", "extraHeaders", "organizationId", "createdAt", "updatedAt") VALUES (` +
		sqlQuote(odd.providerID) + `, 'OpenAI', 'openai', true, '{"OPENAI_API_KEY": "` + oddPlaintextKey + `"}'::jsonb, '[]'::jsonb, %s, now(), now());` +
		`INSERT INTO mydb."ModelProviderScope" (id, "modelProviderId", "scopeType", "scopeId") VALUES (` + sqlQuote(odd.providerID+"_scope") + `, ` + sqlQuote(odd.providerID) + `, 'PROJECT', ` + sqlQuote(odd.keys.project) + `)`
	if _, err := cell.orgSQLFor(ctx, odd.keys.org, statement); err != nil {
		return fmt.Errorf("plaintext provider (SQL): %w", err)
	}
	return nil
}

// plantDatasetRows writes a dataset as a release before object storage left it (contentLayout postgres, rows in
// DatasetRecord); main writes new rows to object storage only, yet still reads these, which the plant proves.
func (cell *run) plantDatasetRows(ctx context.Context) error {
	odd := cell.odd
	id := "ds_upgradelab_postgres_" + strings.ToLower(odd.keys.org[len(odd.keys.org)-8:])
	statement := `INSERT INTO mydb."Dataset" (id, "projectId", name, slug, "columnTypes", "contentLayout", "createdAt", "updatedAt") VALUES (` +
		sqlQuote(id) + `, ` + sqlQuote(odd.keys.project) + `, ` + sqlQuote(oddDataset) + `, ` + sqlQuote(oddDataset) +
		`, '[{"name": "input", "type": "string"}, {"name": "output", "type": "string"}]'::jsonb, 'postgres', now(), now());`
	for index, marker := range oddDatasetMarkers {
		statement += `INSERT INTO mydb."DatasetRecord" (id, "datasetId", "projectId", entry, "createdAt", "updatedAt") VALUES (` +
			sqlQuote(fmt.Sprintf("%s_row_%d", id, index)) + `, ` + sqlQuote(id) + `, ` + sqlQuote(odd.keys.project) +
			`, '{"input": "` + marker + `", "output": "answer ` + marker + `"}'::jsonb, now(), now());`
	}
	if _, err := psql(ctx, cell.stores.psqlURL(), statement); err != nil {
		return fmt.Errorf("dataset rows in Postgres (SQL): %w", err)
	}
	status, body := cell.oddGet(ctx, "/api/dataset/"+oddDataset, odd.keysAPIKey)
	for _, marker := range oddDatasetMarkers {
		if status != http.StatusOK || !strings.Contains(body, marker) {
			return fmt.Errorf("main does not read the Postgres dataset back: GET /api/dataset/%s %d, %s missing", oddDataset, status, marker)
		}
	}
	return nil
}

type oddCall struct {
	key, path string
	body      any
}

func (cell *run) oddPostMain(ctx context.Context, call oddCall) (int, string, error) {
	request, err := Client{URL: cell.fromURL(), APIKey: call.key}.post(ctx, call.path, call.body)
	if err != nil {
		return 0, "", err
	}
	return oddDo(request)
}

func (cell *run) oddGet(ctx context.Context, path, key string) (int, string) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.url()+path, http.NoBody)
	if err != nil {
		return 0, err.Error()
	}
	request.Header.Set("X-Auth-Token", key)
	status, body, err := oddDo(request)
	if err != nil {
		return 0, err.Error()
	}
	return status, body
}

func oddDo(request *http.Request) (int, string, error) {
	response, err := httpClient.Do(request)
	if err != nil {
		return 0, "", err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, string(data), nil
}

func (cell *run) projectKey(ctx context.Context, project string) (string, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT "apiKey" FROM mydb."Project" WHERE id = `+sqlQuote(project))
	if err != nil {
		return "", fmt.Errorf("project %s API key: %w", project, err)
	}
	if strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("project %s has no API key", project)
	}
	return strings.TrimSpace(out), nil
}

func (cell *run) oddCount(ctx context.Context, statement string) (int, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), statement)
	if err != nil {
		return 0, err
	}
	var count int
	_, err = fmt.Sscanf(strings.TrimSpace(out), "%d", &count)
	return count, err
}

// readOddFacts reads the planted rows; on head it also reads them back through head's doors and pages.
func (cell *run) readOddFacts(ctx context.Context, onHead bool) oddFacts {
	odd := cell.odd
	var facts oddFacts
	var errs []error
	if odd.keys.org != "" { // held-tenants plants the held organization alone
		form, err := psql(ctx, cell.stores.psqlURL(), `SELECT jsonb_typeof("customKeys") FROM mydb."ModelProvider" WHERE id = `+sqlQuote(odd.providerID))
		facts.KeysForm = strings.TrimSpace(form)
		errs = append(errs, err)
		facts.DatasetRows, err = cell.oddCount(ctx, `SELECT count(*) FROM mydb."DatasetRecord" r JOIN mydb."Dataset" d ON d.id = r."datasetId" WHERE d."projectId" = `+sqlQuote(odd.keys.project))
		errs = append(errs, err)
		facts.UntaggedTags, err = cell.oddCount(ctx, `SELECT count(*) FROM mydb."PromptTag" WHERE "organizationId" = `+sqlQuote(odd.untagged.org))
		errs = append(errs, err)
	}
	held, err := cell.legacyOrgStanding(ctx, `SELECT status FROM mydb."SystemMigrationTenantState" WHERE "migrationName" = '`+grandfatherStep+`' AND "tenantId" = `+sqlQuote(odd.held.org))
	facts.HeldStates = held
	errs = append(errs, err)
	if !onHead {
		facts.ReadErr = errors.Join(errs...)
		return facts
	}
	facts.OtherHeld, err = cell.legacyOrgStanding(ctx, `SELECT "migrationName" || ':' || "tenantId" || ':' || status FROM mydb."SystemMigrationTenantState" WHERE "migrationName" <> '`+secretHealStep+`' AND status IN ('migrated', 'parked') AND "tenantId" <> `+sqlQuote(odd.held.org)+` ORDER BY 1`)
	errs = append(errs, err)
	if odd.keys.org != "" {
		facts.ProvidersRead, facts.ProvidersBody = cell.oddGet(ctx, "/api/model-providers", odd.keysAPIKey)
		facts.DatasetRead, facts.DatasetBody = cell.oddGet(ctx, "/api/dataset/"+oddDataset, odd.keysAPIKey)
		facts.PromptRead, _ = cell.oddGet(ctx, "/api/prompts/"+oddPrompt, odd.tagsKey)
	}
	facts.OpsText, facts.OpsErr = cell.opsPage(ctx, "ops-upgrades-organizations-held", "/ops/upgrades", "Organizations", odd.held.org)
	facts.HomeText, facts.HomeErr = cell.opsPage(ctx, "home-action-needed-held", "/", "", "")
	facts.ReadErr = errors.Join(errs...)
	return facts
}

func oddSummary(facts oddFacts) string {
	return fmt.Sprintf("keys %s, dataset rows %d, untagged org tags %d, held step states %v", facts.KeysForm, facts.DatasetRows, facts.UntaggedTags, facts.HeldStates)
}

// oddityVerdicts (A1 to A4) judge the planted tenants once head settled.
func (cell *run) oddityVerdicts(ctx context.Context) []Verdict {
	if !cell.overlay(OverlayTenantOddities) {
		return nil
	}
	if cell.odd.err != nil || cell.odd.providerID == "" {
		reason := "not planted"
		if cell.odd.err != nil {
			reason = cell.odd.err.Error()
		}
		return []Verdict{verdict("A1", false, "planting on main stopped: "+reason)}
	}
	return judgeOddities(cell.odd.held.org, cell.odd.before, cell.readOddFacts(ctx, true))
}

// judgeOddities: A1 the held organization is held alone and named to an operator, A2 plaintext keys sealed and still
// read, A3 dataset rows kept and read through head, A4 the untagged organization tagged and its prompt opens.
func judgeOddities(heldOrg string, before, after oddFacts) []Verdict {
	return []Verdict{judgeHeld(heldOrg, after), judgeKeys(before, after), judgeDataset(before, after), judgeUntagged(before, after)}
}

func judgeHeld(heldOrg string, after oddFacts) Verdict {
	held := len(after.HeldStates) == 1 && (after.HeldStates[0] == "migrated" || after.HeldStates[0] == "parked")
	named := after.OpsErr == nil && strings.Contains(after.OpsText, heldOrg)
	// Held organizations live on Ops > Upgrades only; the Home card is for operator steps (modules/ops/specs/upgrades.feature).
	card := after.HomeErr == nil && strings.Contains(after.HomeText, actionNeededCard)
	return verdict("A1", held && named && len(after.OtherHeld) == 0, fmt.Sprintf(
		"held organization %s state %v (want migrated or parked); others held or parked: %v; Ops > Upgrades > Organizations names it: %t%s; Home shows %q to the operator (not expected for a held organization): %t%s (names it: %t)",
		heldOrg, after.HeldStates, after.OtherHeld, named, oddErr(after.OpsErr), actionNeededCard, card, oddErr(after.HomeErr), strings.Contains(after.HomeText, heldOrg)))
}

func judgeKeys(before, after oddFacts) Verdict {
	lists, leaks := strings.Contains(after.ProvidersBody, "openai"), strings.Contains(after.ProvidersBody, oddPlaintextKey)
	read := after.ProvidersRead == http.StatusOK && lists && !leaks
	return verdict("A2", before.KeysForm == "object" && after.KeysForm == "string" && read, fmt.Sprintf(
		"customKeys before %q, after %q (want object then string: sealed); head's GET /api/model-providers %d, lists openai: %t, shows the plaintext key: %t",
		before.KeysForm, after.KeysForm, after.ProvidersRead, lists, leaks))
}

func judgeDataset(before, after oddFacts) Verdict {
	missing := []string{}
	for _, marker := range oddDatasetMarkers {
		if !strings.Contains(after.DatasetBody, marker) {
			missing = append(missing, marker)
		}
	}
	kept := before.DatasetRows == len(oddDatasetMarkers) && after.DatasetRows >= before.DatasetRows
	return verdict("A3", kept && after.DatasetRead == http.StatusOK && len(missing) == 0, fmt.Sprintf(
		"Postgres rows before %d, after %d (nothing deleted); head's GET /api/dataset/%s %d, rows missing from it: %v",
		before.DatasetRows, after.DatasetRows, oddDataset, after.DatasetRead, missing))
}

func judgeUntagged(before, after oddFacts) Verdict {
	return verdict("A4", before.UntaggedTags == 0 && after.UntaggedTags > 0 && after.PromptRead == http.StatusOK, fmt.Sprintf(
		"tags before %d, after %d; head's GET /api/prompts/%s %d", before.UntaggedTags, after.UntaggedTags, oddPrompt, after.PromptRead))
}

func oddErr(err error) string {
	if err == nil {
		return ""
	}
	return " (" + err.Error() + ")"
}

// organizations are the ones the overlay made; empty when it did not run.
func (odd oddSeed) organizations() []string {
	var made []string
	for _, each := range []madeOrganization{odd.held, odd.keys, odd.untagged} {
		if each.org != "" {
			made = append(made, each.org)
		}
	}
	return made
}

// withoutOrganizations drops "organization:role" memberships of the given organizations from each member's list.
func withoutOrganizations(memberships map[string][]string, organizations []string) map[string][]string {
	if len(organizations) == 0 {
		return memberships
	}
	kept := make(map[string][]string, len(memberships))
	for member, list := range memberships {
		for _, membership := range list {
			if !slices.Contains(organizations, strings.SplitN(membership, ":", 2)[0]) {
				kept[member] = append(kept[member], membership)
			}
		}
	}
	return kept
}
