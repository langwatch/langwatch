package cell

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
)

// OverlayRetention plants aged telemetry under three retention rules (trial T2, ledger UM-25).
const OverlayRetention = "retention"

// Overlays a cell accepts (-overlays), applied on top of its shape.
var Overlays = []string{OverlayRetention, OverlayTenantOddities, OverlayOperatorDamage, OverlayHeldTenants, OverlayUpcastEvents, OverlayQueuedJobs}

// agedSlices are the ages in days the overlay writes rows at: each lands in an old weekly partition of its own.
var agedSlices = []int{30, 61, 95, 400}

// agedRowsPerTable bounds the rows cloned per table, organization and slice.
const agedRowsPerTable = 25

// agedTraceID derives a new 32-hex trace id per slice, so a clone never folds into its source under a replacing engine.
const agedTraceID = "lower(hex(substring(SHA256(concat(TraceId, '{tag}')), 1, 16)))"

// agedTable is one retention-managed table the overlay clones into: the partition time and the columns rewritten.
type agedTable struct {
	Table, Kind, At string
	Replace         []string // {tenant}, {age}, {tag} and {retention} are filled per organization and slice
}

const shiftNanos = "{age} * 86400000000000"

var agedTables = []agedTable{
	{"trace_summaries", "traces", "OccurredAt", []string{agedTraceID + " AS TraceId",
		"OccurredAt - toIntervalDay({age}) AS OccurredAt", "CreatedAt - toIntervalDay({age}) AS CreatedAt", "UpdatedAt - toIntervalDay({age}) AS UpdatedAt"}},
	{"stored_spans", "spans", "StartTime", []string{agedTraceID + " AS TraceId",
		"StartTime - toIntervalDay({age}) AS StartTime", "EndTime - toIntervalDay({age}) AS EndTime"}},
	{"log_records", "logs", "TimeUnixMs", []string{"lower(hex(SHA256(concat(RecordId, '{tag}')))) AS RecordId",
		"TimeUnixMs - toIntervalDay({age}) AS TimeUnixMs", "TimeUnixNano - " + shiftNanos + " AS TimeUnixNano", "ObservedTimeUnixNano - " + shiftNanos + " AS ObservedTimeUnixNano"}},
	{"metric_data_points", "metric points", "TimeUnixMs", []string{"lower(hex(SHA256(concat(PointId, '{tag}')))) AS PointId",
		"TimeUnixMs - toIntervalDay({age}) AS TimeUnixMs", "TimeUnixNano - " + shiftNanos + " AS TimeUnixNano", "StartTimeUnixNano - " + shiftNanos + " AS StartTimeUnixNano"}},
	// Event ids, aggregate ids and payloads stay as main wrote them (I7 parses them); the idempotency key alone tells the clones apart.
	{"event_log", "events", "toDateTime64(EventOccurredAt / 1000, 3)", []string{"concat(IdempotencyKey, '{tag}') AS IdempotencyKey",
		"EventTimestamp - {age} * 86400000 AS EventTimestamp", "EventOccurredAt - {age} * 86400000 AS EventOccurredAt"}},
}

// retentionOrg is one organization the overlay made through main's doors and the rule it set there.
type retentionOrg struct {
	Label          string `json:"label"`
	OrganizationID string `json:"organizationId"`
	ProjectID      string `json:"projectId"`
	Scope          string `json:"scope"`            // PROJECT, ORGANIZATION, or "" for main's default
	RuleDays       int    `json:"ruleDays"`         // the rule set; 0 for none
	EffectiveDays  int    `json:"effectiveDays"`    // main's resolved traces retention, stamped into _retention_days
	Target         string `json:"target,omitempty"` // the ClickHouse target label its rows live on; "" shared
}

// retentionPlan is the overlay's three organizations (UM-25): a project rule, an organization rule, none.
var retentionPlan = []retentionOrg{
	{Label: "project-rule", Scope: "PROJECT", RuleDays: 63},
	{Label: "org-rule", Scope: "ORGANIZATION", RuleDays: 35}, // paid plans may pick only 35 or 63 days on main
	{Label: "default"},
}

// sliceCount is one organization x kind x age slice: rows at the cut, how many main's own TTL may expire, rows after.
type sliceCount struct {
	Org       string `json:"org"`
	Kind      string `json:"kind"`
	Table     string `json:"table"`
	Slice     int    `json:"sliceDays"`
	Retention int    `json:"retentionDays"` // the org's effective traces retention as main resolved it
	Seeded    int    `json:"seeded"`
	AtCut     int    `json:"atCut"`
	Expirable int    `json:"expirable"` // stamped by main to expire by the end of the cell (one day of slack)
	Expect    string `json:"expectAfter"`
	After     int    `json:"after"`
}

// retentionState is what the overlay planted and measured.
type retentionState struct {
	orgs   []retentionOrg
	counts []sliceCount
	seeded map[string]int // per table, the source rows each slice cloned
	err    error          // planting stopped; R1 reports it
}

func (cell *run) overlay(name string) bool { return slices.Contains(cell.options.Overlays, name) }

// agedOnly is a retention overlay project: it holds only clones dated before the month the meter seeds (I5).
func (cell *run) agedOnly(tenant string) bool {
	return slices.ContainsFunc(cell.retention.orgs, func(org retentionOrg) bool { return org.ProjectID == tenant })
}

// retentionRules makes the overlay's organizations as the seed account, each on a paid plan (main refuses rules on
// free), sets the rules through main's dataRetention.setForScope and reads back the retention main resolves.
func (cell *run) retentionRules(ctx context.Context) error {
	for index, plan := range retentionPlan {
		org, err := cell.retentionOrganization(ctx, index, plan)
		if err != nil {
			cell.retention.err = fmt.Errorf("organization %s: %w", plan.Label, err)
			return nil
		}
		cell.retention.orgs = append(cell.retention.orgs, org)
	}
	if len(cell.private) > 0 {
		org, err := cell.privateRetentionOrg(ctx)
		if err != nil {
			cell.report.Notes = append(cell.report.Notes, "retention on the private target (H-e) not planted: "+err.Error())
			return nil //nolint:nilerr // the overlay records its failure for R1 and the cell goes on
		}
		cell.retention.orgs = append(cell.retention.orgs, org)
	}
	return nil
}

// privateRetentionOrg sets an organization rule on the hybrid private organization, whose rows live on its own
// target: the seed account joins it as an admin (membership and organization role binding) on a paid plan first,
// as an operator would to set the rule. Main decides from the Grant projection, so the grant row goes in beside the
// binding (T7-F8: main refused the rule without organization:manage). A built-in role leaves legacyRole empty, as the
// product writes it; set, the authz-engine proof held the organization forever (T7-F15).
func (cell *run) privateRetentionOrg(ctx context.Context) (retentionOrg, error) {
	client, label, ok := cell.privateClient()
	if !ok {
		return retentionOrg{}, fmt.Errorf("no private project in the tenancy")
	}
	org := retentionOrg{Label: "private-rule", Scope: "ORGANIZATION", RuleDays: 63, Target: label, OrganizationID: cell.private[label], ProjectID: client.Project}
	email, _ := generate.SeedAccount(cell.options.Seed)
	//nolint:dupword // SQL: createdAt and updatedAt both take now()
	statement := fmt.Sprintf(`INSERT INTO mydb."OrganizationUser" ("userId", "organizationId", role, "createdAt", "updatedAt") SELECT id, %[2]s, 'ADMIN', now(), now() FROM mydb."User" WHERE email = %[1]s ON CONFLICT DO NOTHING;
INSERT INTO mydb."TeamUser" ("userId", "teamId", role, "createdAt", "updatedAt") SELECT u.id, p."teamId", 'ADMIN', now(), now() FROM mydb."User" u, mydb."Project" p WHERE u.email = %[1]s AND p.id = %[3]s ON CONFLICT DO NOTHING;
INSERT INTO mydb."RoleBinding" (id, "organizationId", "userId", role, "scopeType", "scopeId", "createdAt", "updatedAt") SELECT %[4]s, %[2]s, id, 'ADMIN', 'ORGANIZATION', %[2]s, now(), now() FROM mydb."User" WHERE email = %[1]s ON CONFLICT DO NOTHING;
INSERT INTO mydb."Grant" (id, "organizationId", "principalType", "principalId", "roleKey", source, "scopeType", "scopeId", "occurredAt") SELECT %[4]s, %[2]s, 'USER', id, 'admin', 'migration', 'ORGANIZATION', %[2]s, now() FROM mydb."User" WHERE email = %[1]s ON CONFLICT DO NOTHING;
INSERT INTO mydb."Subscription" (id, "organizationId", plan, status, "startDate", "createdAt", "updatedAt") VALUES (%[5]s, %[2]s, 'LAUNCH', 'ACTIVE', now(), now(), now()) ON CONFLICT DO NOTHING`,
		sqlQuote(email), sqlQuote(org.OrganizationID), sqlQuote(org.ProjectID),
		sqlQuote(fmt.Sprintf("snap_private_rule_binding_%d", cell.options.Seed)), sqlQuote(fmt.Sprintf("snap_private_rule_plan_%d", cell.options.Seed)))
	if _, err := psql(ctx, cell.stores.psqlURL(), statement); err != nil {
		return org, fmt.Errorf("seed account membership (SQL): %w", err)
	}
	return cell.applyRetentionRule(ctx, org)
}

func (cell *run) retentionOrganization(ctx context.Context, index int, org retentionOrg) (retentionOrg, error) {
	made, err := cell.newOrganization(ctx, fmt.Sprintf("Retention %s %s", org.Label, cell.options.Name()))
	if err != nil {
		return org, err
	}
	org.OrganizationID, org.ProjectID = made.org, made.project
	//nolint:dupword // SQL: startDate, createdAt and updatedAt each take now()
	statement := fmt.Sprintf(`INSERT INTO mydb."Subscription" (id, "organizationId", plan, status, "startDate", "createdAt", "updatedAt") VALUES (%s, %s, 'LAUNCH', 'ACTIVE', now(), now(), now())`,
		sqlQuote(fmt.Sprintf("snap_retention_%d_%d", cell.options.Seed, index+1)), sqlQuote(org.OrganizationID))
	if _, err := psql(ctx, cell.stores.psqlURL(), statement); err != nil {
		return org, fmt.Errorf("paid subscription (SQL): %w", err)
	}
	return cell.applyRetentionRule(ctx, org)
}

// applyRetentionRule sets the organization's rule through main's door and reads back what main resolves.
func (cell *run) applyRetentionRule(ctx context.Context, org retentionOrg) (retentionOrg, error) {
	if org.Scope != "" {
		scope := map[string]any{"scopeType": org.Scope, "scopeId": org.ProjectID}
		if org.Scope == "ORGANIZATION" {
			scope["scopeId"] = org.OrganizationID
		}
		input := map[string]any{"projectId": org.ProjectID, "scope": scope, "category": "traces", "retentionDays": org.RuleDays}
		if err := cell.seeder.Call(ctx, true, "dataRetention.setForScope", input, nil); err != nil {
			return org, err
		}
	}
	var snapshot struct {
		Effective struct {
			Traces int `json:"traces"`
		} `json:"effective"`
	}
	if err := cell.seeder.Call(ctx, false, "dataRetention.getRules", map[string]any{"projectId": org.ProjectID}, &snapshot); err != nil {
		return org, err
	}
	if org.EffectiveDays = snapshot.Effective.Traces; org.EffectiveDays == 0 {
		return org, fmt.Errorf("dataRetention.getRules resolved no traces retention for %s", org.ProjectID)
	}
	return org, nil
}

// madeOrganization is an organization the seed account made through main's sign-up door, with its first team and project.
type madeOrganization struct{ org, team, project, slug string }

// newOrganization makes one more organization as the seed account, through main's own onboarding door.
func (cell *run) newOrganization(ctx context.Context, name string) (madeOrganization, error) {
	var created struct{ OrganizationID, ProjectSlug string }
	if err := cell.seeder.Call(ctx, true, "onboarding.initializeOrganization", map[string]any{"orgName": name, "projectName": name}, &created); err != nil {
		return madeOrganization{}, err
	}
	var organizations []struct {
		Teams []struct {
			ID       string
			Projects []struct{ ID, Slug string }
		}
	}
	if err := cell.seeder.Call(ctx, false, "organization.getAll", map[string]any{}, &organizations); err != nil {
		return madeOrganization{}, err
	}
	for _, each := range organizations {
		for _, team := range each.Teams {
			for _, project := range team.Projects {
				if project.Slug == created.ProjectSlug {
					return madeOrganization{org: created.OrganizationID, team: team.ID, project: project.ID, slug: project.Slug}, nil
				}
			}
		}
	}
	return madeOrganization{}, fmt.Errorf("organization.getAll lists no project %s", created.ProjectSlug)
}

func sqlQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

// retentionAge clones the seed project's own rows, as main wrote them during traffic, into each overlay
// organization at every age, stamped with the retention main resolved for it: ingestion refuses spans
// older than 31 days, so ClickHouse is the only door to an old partition.
func (cell *run) retentionAge(ctx context.Context) error {
	if cell.retention.err != nil {
		return nil //nolint:nilerr // the failure is already recorded on the run and judged by the check
	}
	cell.retention.seeded = map[string]int{}
	for _, table := range agedTables {
		for _, org := range cell.retention.orgs {
			target, source := cell.stores.queryURL(org.Target), cell.client.Project
			if org.Target != "" {
				source = cell.privateTraffic.Client.Project
			}
			final, err := finalClause(ctx, target, table.Table)
			if err != nil {
				cell.retention.err = err
				return nil //nolint:nilerr // the overlay records its failure for R1 and the cell goes on
			}
			key := org.Target + "/" + table.Table
			if _, counted := cell.retention.seeded[key]; !counted {
				out, err := clickhouseQuery(ctx, target, fmt.Sprintf("SELECT count() FROM (SELECT 1 FROM %s%s WHERE TenantId = %s LIMIT %d) FORMAT TSV", table.Table, final, sqlQuote(source), agedRowsPerTable))
				if err != nil {
					cell.retention.err = err
					return nil //nolint:nilerr // the overlay records its failure for R1 and the cell goes on
				}
				cell.retention.seeded[key], _ = strconv.Atoi(strings.TrimSpace(out))
			}
			for _, age := range agedSlices {
				statement := agedInsert(agedInsertInput{Table: table, Final: final, Source: source, Tenant: org.ProjectID, Age: age, Retention: org.EffectiveDays})
				if _, err := clickhouseQuery(ctx, target, statement); err != nil {
					cell.retention.err = fmt.Errorf("aged %s for %s at %d days: %w", table.Table, org.Label, age, err)
					return nil
				}
			}
		}
	}
	return nil
}

type agedInsertInput struct {
	Table                 agedTable
	Final, Source, Tenant string
	Age, Retention        int
}

// agedInsert is one INSERT ... SELECT cloning up to agedRowsPerTable of the source tenant's newest rows.
func agedInsert(input agedInsertInput) string {
	fill := strings.NewReplacer("{tenant}", sqlQuote(input.Tenant), "{age}", strconv.Itoa(input.Age),
		"{tag}", fmt.Sprintf("-aged%d", input.Age), "{retention}", strconv.Itoa(input.Retention))
	replace := append([]string{"{tenant} AS TenantId", "{retention} AS _retention_days"}, input.Table.Replace...)
	for index := range replace {
		replace[index] = fill.Replace(replace[index])
	}
	return fmt.Sprintf("INSERT INTO %s SELECT * REPLACE (%s) FROM %s%s WHERE TenantId = %s ORDER BY %s DESC LIMIT %d",
		input.Table.Table, strings.Join(replace, ", "), input.Table.Table, input.Final, sqlQuote(input.Source), input.Table.At, agedRowsPerTable)
}

// finalClause is " FINAL" for an engine that folds rows on merge, as the fingerprint counts them.
func finalClause(ctx context.Context, target, table string) (string, error) {
	engine, err := clickhouseQuery(ctx, target, "SELECT engine FROM system.tables WHERE database = currentDatabase() AND name = "+sqlQuote(table)+" FORMAT TSV")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(engine) == "" {
		return "", fmt.Errorf("table %s does not exist on main", table)
	}
	for _, folding := range []string{"Replacing", "Collapsing", "Aggregating", "Summing"} {
		if strings.Contains(engine, folding) {
			return " FINAL", nil
		}
	}
	return "", nil
}

// agedCountQuery buckets one table's overlay rows by age slice per tenant: count, and how many main stamped to expire.
func agedCountQuery(table agedTable, final string, tenants []string) string {
	quoted := make([]string, len(tenants))
	for index, tenant := range tenants {
		quoted[index] = sqlQuote(tenant)
	}
	return fmt.Sprintf(`SELECT TenantId, multiIf(age < 45, 30, age < 80, 61, age < 200, 95, 400) AS slice, count(),
countIf(_retention_days > 0 AND at + toIntervalDay(_retention_days) < now() + INTERVAL 1 DAY)
FROM (SELECT TenantId, _retention_days, %s AS at, dateDiff('day', %s, now()) AS age FROM %s%s WHERE TenantId IN (%s))
WHERE age >= 20 GROUP BY TenantId, slice FORMAT TSV`, table.At, table.At, table.Table, final, strings.Join(quoted, ", "))
}

type agedKey struct {
	tenant string
	slice  int
}

// parseAgedCounts reads agedCountQuery's TSV: per tenant and slice, the count and the expirable count.
func parseAgedCounts(out string) map[agedKey][2]int {
	counts := map[agedKey][2]int{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) != 4 {
			continue
		}
		slice, _ := strconv.Atoi(fields[1])
		count, _ := strconv.Atoi(fields[2])
		expirable, _ := strconv.Atoi(fields[3])
		counts[agedKey{fields[0], slice}] = [2]int{count, expirable}
	}
	return counts
}

// countAged reads every overlay slice from each organization's own target.
func (cell *run) countAged(ctx context.Context) (map[string]map[agedKey][2]int, error) {
	tenantsAt := map[string][]string{}
	for _, org := range cell.retention.orgs {
		tenantsAt[org.Target] = append(tenantsAt[org.Target], org.ProjectID)
	}
	byTable := map[string]map[agedKey][2]int{}
	for label, tenants := range tenantsAt {
		target := cell.stores.queryURL(label)
		for _, table := range agedTables {
			final, err := finalClause(ctx, target, table.Table)
			if err != nil {
				return nil, err
			}
			out, err := clickhouseQuery(ctx, target, agedCountQuery(table, final, tenants))
			if err != nil {
				return nil, err
			}
			if byTable[table.Table] == nil {
				byTable[table.Table] = map[agedKey][2]int{}
			}
			maps.Copy(byTable[table.Table], parseAgedCounts(out))
		}
	}
	return byTable, nil
}

// retentionAtCut records each slice as the cut leaves it, with what main's own TTL may still expire.
func (cell *run) retentionAtCut(ctx context.Context) error {
	if cell.retention.err != nil {
		return nil //nolint:nilerr // the failure is already recorded on the run and judged by the check
	}
	counts, err := cell.countAged(ctx)
	if err != nil {
		cell.retention.err = fmt.Errorf("count at the cut: %w", err)
		return nil
	}
	for _, table := range agedTables {
		for _, org := range cell.retention.orgs {
			for _, age := range agedSlices {
				measured := counts[table.Table][agedKey{org.ProjectID, age}]
				cell.retention.counts = append(cell.retention.counts, sliceCount{Org: org.Label, Kind: table.Kind, Table: table.Table, Slice: age, Retention: org.EffectiveDays,
					Seeded: cell.retention.seeded[org.Target+"/"+table.Table], AtCut: measured[0], Expirable: measured[1], Expect: expectAfter(measured[0], measured[1]), After: -1})
			}
		}
	}
	return nil
}

func expectAfter(atCut, expirable int) string {
	if expirable == 0 {
		return strconv.Itoa(atCut)
	}
	return fmt.Sprintf("%d to %d (main's TTL may expire %d on ClickHouse's schedule)", atCut-expirable, atCut, expirable)
}

// retentionAllowance is, per fingerprint store and table, how many rows main's own retention TTL may remove (I4).
func (cell *run) retentionAllowance() map[string]map[string]int64 {
	allowance := map[string]map[string]int64{"clickhouse/shared": {}}
	for _, count := range cell.retention.counts {
		store := "clickhouse/" + clickHouseTarget(cell.retentionTarget(count.Org))
		if allowance[store] == nil {
			allowance[store] = map[string]int64{}
		}
		allowance[store][count.Table] += int64(count.Expirable)
	}
	return allowance
}

// retentionTarget is the target label of an overlay organization, by its overlay label.
func (cell *run) retentionTarget(label string) string {
	for _, org := range cell.retention.orgs {
		if org.Label == label {
			return org.Target
		}
	}
	return ""
}

// retentionVerdict (R1): every organization's every age slice holds after the upgrade what it held at the cut,
// less at most what main stamped to expire; no TTL merge is forced.
func (cell *run) retentionVerdict(ctx context.Context) []Verdict {
	if !cell.overlay(OverlayRetention) {
		return nil
	}
	if cell.retention.err != nil {
		return []Verdict{verdict("R1", false, "planting stopped: "+cell.retention.err.Error())}
	}
	counts, err := cell.countAged(ctx)
	if err != nil {
		return []Verdict{{ID: "R1", Name: invariantNames["R1"], Result: "inconclusive", Detail: "count after: " + err.Error()}}
	}
	for index := range cell.retention.counts {
		each := &cell.retention.counts[index]
		org := cell.retention.orgs[slices.IndexFunc(cell.retention.orgs, func(org retentionOrg) bool { return org.Label == each.Org })]
		each.After = counts[each.Table][agedKey{org.ProjectID, each.Slice}][0]
	}
	data, _ := json.MarshalIndent(map[string]any{"orgs": cell.retention.orgs, "slices": cell.retention.counts}, "", "  ")
	_ = os.WriteFile(filepath.Join(cell.options.RunDir, "retention.json"), data, 0o600)
	return []Verdict{judgeRetention(cell.retention.counts), cell.agedReadVerdict(ctx)}
}

// agedReadVerdict (R2): per organization, the oldest aged trace still stored reads back through head's tRPC.
func (cell *run) agedReadVerdict(ctx context.Context) Verdict {
	cell.seeder.PlainWire = true // the reads go to head
	var read, failed []string
	for _, org := range cell.retention.orgs {
		query := fmt.Sprintf("SELECT TraceId, dateDiff('day', OccurredAt, now()) FROM trace_summaries FINAL WHERE TenantId = %s AND dateDiff('day', OccurredAt, now()) >= 20 ORDER BY OccurredAt ASC LIMIT 1 FORMAT TSV", sqlQuote(org.ProjectID))
		out, err := clickhouseQuery(ctx, cell.stores.queryURL(org.Target), query)
		trace, age, _ := strings.Cut(strings.TrimSpace(out), "\t")
		if err != nil || trace == "" {
			failed = append(failed, fmt.Sprintf("%s: no aged trace to read (%s)", org.Label, errText(err)))
			continue
		}
		var got struct {
			TraceID string `json:"trace_id"`
		}
		if err := cell.seeder.Call(ctx, false, "traces.getById", map[string]any{"projectId": org.ProjectID, "traceId": trace}, &got); err != nil {
			failed = append(failed, fmt.Sprintf("%s %sd %s: %.200s", org.Label, age, trace, err.Error()))
			continue
		}
		read = append(read, fmt.Sprintf("%s %sd %s", org.Label, age, trace))
	}
	return verdict("R2", len(failed) == 0 && len(read) > 0, fmt.Sprintf("read through head's traces.getById: %v; failed: %v", read, failed))
}

// judgeRetention fails any slice that lost more than main's TTL may take, and is inconclusive when a slice
// held nothing at the cut, unless main's own TTL emptied a slice older than the org's retention before it.
func judgeRetention(counts []sliceCount) Verdict {
	var lost, empty, expired, lines []string
	for _, each := range counts {
		name := fmt.Sprintf("%s %s %dd", each.Org, each.Kind, each.Slice)
		lines = append(lines, fmt.Sprintf("%s %d->%d", name, each.AtCut, each.After))
		switch {
		case each.AtCut == 0 && each.Seeded > 0 && each.Retention > 0 && each.Slice > each.Retention:
			expired = append(expired, name)
		case each.AtCut == 0:
			empty = append(empty, name)
		case each.After < each.AtCut-each.Expirable:
			lost = append(lost, fmt.Sprintf("%s %d->%d (TTL may take %d)", name, each.AtCut, each.After, each.Expirable))
		}
	}
	detail := fmt.Sprintf("lost: %v; empty at the cut: %v; expired by main's TTL before the cut: %v; per slice at the cut -> after: %s", lost, empty, expired, strings.Join(lines, ", "))
	if len(lost) == 0 && len(empty) > 0 {
		return Verdict{ID: "R1", Name: invariantNames["R1"], Result: "inconclusive", Detail: detail}
	}
	return verdict("R1", len(lost) == 0, detail)
}
