package idpsim

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

/**
 * A SYNC, not a replay.
 *
 * `pushDirectory` sends every user as a create, which is the right thing
 * exactly once. The second run against the same target is all conflicts, so
 * the question a large directory is interesting for — what does the receiving
 * side do when two hundred people are deactivated and fifty join — could not
 * be asked at all.
 *
 * This reconciles instead. It reads what the target is holding, matches it
 * against the tenant's directory the way a real identity provider does, and
 * sends only the difference: creates for arrivals, updates for changes,
 * deactivations or deletes for departures. Running it twice with nothing
 * changed in between sends nothing, which is the property that makes every
 * later run a measurement of the change rather than of the directory.
 *
 * MATCHED ON externalId, falling back to userName. That is the order a real
 * provider uses and the order that makes a rename survive: somebody who
 * changes their name and address keeps their external id, so they are an
 * UPDATE here and not a delete followed by a create — which is what a match on
 * address alone would produce, and what would silently orphan everything the
 * receiving side had attached to them.
 */

// SyncMode decides what a departure means on the receiving side.
type SyncMode string

const (
	// SyncDeactivate flips `active` to false and leaves the record, which is
	// what most identity providers actually send. The receiving side should
	// treat it as a suspension.
	SyncDeactivate SyncMode = "deactivate"
	// SyncDelete removes the record outright.
	SyncDelete SyncMode = "delete"
)

// SyncOptions tune one reconciliation run.
type SyncOptions struct {
	// Mode is what a departure sends. Defaults to deactivation.
	Mode SyncMode `json:"mode,omitempty"`
	// Concurrency is how many requests are in flight at once. A directory of
	// thousands sent one at a time measures the round trip, not the receiving
	// side; a real provider uses a handful of connections, so this defaults to
	// one.
	Concurrency int `json:"concurrency,omitempty"`
	// Groups syncs group membership too. Off by default because it is the
	// slower half and not always what is being measured.
	Groups bool `json:"groups,omitempty"`
	// DryRun works out the difference and sends nothing, which is how you see
	// what a round WOULD do before doing it.
	DryRun bool `json:"dryRun,omitempty"`
}

const (
	defaultSyncConcurrency = 8
	maxSyncConcurrency     = 64
)

// resolved fills in the defaults, and caps concurrency: the point is to
// exercise the receiving side, not to find out how it fails under a thousand
// simultaneous connections from one laptop.
func (o SyncOptions) resolved() SyncOptions {
	if o.Mode != SyncDelete {
		o.Mode = SyncDeactivate
	}
	if o.Concurrency <= 0 {
		o.Concurrency = defaultSyncConcurrency
	}
	o.Concurrency = min(o.Concurrency, maxSyncConcurrency)
	return o
}

// syncRun is one reconciliation: whose directory, into what, how.
type syncRun struct {
	tenant *Tenant
	target ProvisioningTarget
	opts   SyncOptions
}

// SyncResult is what one reconciliation did, and how long it took.
type SyncResult struct {
	Created     int `json:"created"`
	Updated     int `json:"updated"`
	Deactivated int `json:"deactivated"`
	Deleted     int `json:"deleted"`
	Unchanged   int `json:"unchanged"`
	// GroupsWritten counts group creates and membership replacements.
	GroupsWritten int `json:"groupsWritten,omitempty"`
	// TargetHeld is what the target was holding BEFORE this run, which is the
	// number that makes the others readable.
	TargetHeld int `json:"targetHeld"`
	// Failures are the resources the target refused, one line each, capped.
	Failures []string `json:"failures,omitempty"`
	// FailureCount is the true number, which `Failures` may have truncated.
	FailureCount int `json:"failureCount,omitempty"`
	// Elapsed is wall-clock for the whole run.
	Elapsed        string  `json:"elapsed"`
	ElapsedMs      int64   `json:"elapsedMs"`
	RequestsPerSec float64 `json:"requestsPerSec,omitempty"`
	DryRun         bool    `json:"dryRun,omitempty"`
}

// maxReportedFailures keeps a run against a target that refuses everything
// from producing a response bigger than the directory.
const maxReportedFailures = 25

// targetUser is one record the receiving side is holding, as the matcher needs
// it.
type targetUser struct {
	id         string
	userName   string
	externalID string
	active     bool
}

/**
 * syncDirectory reconciles the tenant's directory into the target.
 *
 * Read first, then write. The read is the expensive half and it is also the
 * half that makes the run honest: the target's own account of what it holds is
 * what the difference is computed against, so a receiving side that quietly
 * dropped half of the last push shows up as two hundred creates rather than as
 * two hundred no-ops against a map we kept ourselves.
 */
func syncDirectory(ctx context.Context, run syncRun) SyncResult {
	t, target := run.tenant, run.target
	opts := run.opts.resolved()
	started := time.Now()
	client := &http.Client{Timeout: 60 * time.Second}
	base := strings.TrimSuffix(target.BaseURL, "/")

	held, err := fetchTargetUsers(ctx, client, scimTarget{URL: base, Token: target.Token})
	if err != nil {
		return SyncResult{
			Failures:     []string{"could not read the target back: " + err.Error()},
			FailureCount: 1,
			Elapsed:      time.Since(started).String(),
			ElapsedMs:    time.Since(started).Milliseconds(),
		}
	}

	plan := planSync(t.Users(), held, opts.Mode)
	result := SyncResult{
		TargetHeld: len(held),
		Unchanged:  plan.unchanged,
		DryRun:     opts.DryRun,
	}
	if opts.DryRun {
		result.Created, result.Updated = len(plan.create), len(plan.update)
		result.Deactivated, result.Deleted = countDepartures(plan.depart, opts.Mode)
		finishSync(&result, started, 0)
		return result
	}

	writes := applyPlan(ctx, client, syncWrite{
		base: base, token: target.Token, plan: plan, opts: opts,
	})
	result.Created, result.Updated = writes.created, writes.updated
	result.Deactivated, result.Deleted = writes.deactivated, writes.deleted
	result.Failures, result.FailureCount = writes.failures, writes.failureCount

	if opts.Groups {
		groups := syncGroups(ctx, client, syncGroupWrite{
			base: base, token: target.Token, tenant: t,
		})
		result.GroupsWritten = groups.created + groups.updated
		result.FailureCount += groups.failureCount
		result.Failures = append(result.Failures, groups.failures...)
		if len(result.Failures) > maxReportedFailures {
			result.Failures = result.Failures[:maxReportedFailures]
		}
		writes.requests += groups.requests
	}
	finishSync(&result, started, writes.requests)
	return result
}

// finishSync stamps the timing every run reports.
func finishSync(result *SyncResult, started time.Time, requests int) {
	elapsed := time.Since(started)
	result.Elapsed = elapsed.Round(time.Millisecond).String()
	result.ElapsedMs = elapsed.Milliseconds()
	if seconds := elapsed.Seconds(); seconds > 0 && requests > 0 {
		result.RequestsPerSec = float64(requests) / seconds
	}
}

// syncPlan is the difference between the tenant's directory and the target's.
type syncPlan struct {
	create    []*User
	update    []plannedUpdate
	depart    []targetUser
	unchanged int
}

// plannedUpdate pairs a local user with the target record it already has.
type plannedUpdate struct {
	user     *User
	targetID string
}

/**
 * planSync works out what to send, matching on external id then user name.
 *
 * A target record matching nobody local is a DEPARTURE — somebody taken off
 * the identity provider — and one that is already inactive is left alone, so a
 * second run after a deactivation round sends nothing rather than deactivating
 * the same people again.
 */
func planSync(local []*User, held []targetUser, mode SyncMode) syncPlan {
	byExternal, byUserName := indexTargetUsers(held)

	plan, matched := planArrivalsAndChanges(local, byExternal, byUserName)
	plan.depart, plan.unchanged = planDepartures(departureInput{
		held: held, matched: matched, mode: mode, unchanged: plan.unchanged,
	})
	return plan
}

// planArrivalsAndChanges decides, for each local user, whether the target has
// never heard of them, already agrees, or holds something stale.
func planArrivalsAndChanges(
	local []*User,
	byExternal map[string]targetUser,
	byUserName map[string]targetUser,
) (syncPlan, map[string]bool) {
	var plan syncPlan
	matched := map[string]bool{}
	for _, u := range local {
		existing, found := matchTarget(u, byExternal, byUserName)
		if !found {
			if u.Active {
				plan.create = append(plan.create, u)
			} else {
				plan.unchanged++
			}
			continue
		}
		matched[existing.id] = true
		// `active` and `userName` are the two fields worth comparing without
		// re-reading each record whole; everything else rides along on the
		// update a change to either produces.
		if existing.active == u.Active && existing.userName == u.UserName {
			plan.unchanged++
			continue
		}
		plan.update = append(plan.update, plannedUpdate{user: u, targetID: existing.id})
	}
	return plan, matched
}

// departureInput is what deciding the departures needs.
type departureInput struct {
	held      []targetUser
	matched   map[string]bool
	mode      SyncMode
	unchanged int
}

// planDepartures picks out the target records that match nobody local, leaving
// alone the ones a deactivating sync has already retired — so a second run
// after a deactivation round sends nothing rather than repeating itself.
func planDepartures(in departureInput) ([]targetUser, int) {
	var depart []targetUser
	unchanged := in.unchanged
	for _, h := range in.held {
		switch {
		case in.matched[h.id]:
		case in.mode == SyncDeactivate && !h.active:
			unchanged++
		default:
			depart = append(depart, h)
		}
	}
	return depart, unchanged
}

// matchTarget finds the target's record for one local user.
func matchTarget(
	u *User,
	byExternal map[string]targetUser,
	byUserName map[string]targetUser,
) (targetUser, bool) {
	if u.ExternalID != "" {
		if existing, ok := byExternal[u.ExternalID]; ok {
			return existing, true
		}
	}
	existing, ok := byUserName[strings.ToLower(u.UserName)]
	return existing, ok
}

// countDepartures splits a departure count by what the mode would send.
func countDepartures(depart []targetUser, mode SyncMode) (deactivated, deleted int) {
	if mode == SyncDelete {
		return 0, len(depart)
	}
	return len(depart), 0
}

// syncWrite is one write pass over a plan.
type syncWrite struct {
	base  string
	token string
	plan  syncPlan
	opts  SyncOptions
}

// writeTally is what the write pass did.
type writeTally struct {
	created, updated, deactivated, deleted int
	requests                               int
	failures                               []string
	failureCount                           int
}

/**
 * note records one finished request.
 *
 * Failures are counted in full and REPORTED only up to a cap: a target that
 * refuses everything would otherwise produce a response longer than the
 * directory, and the twenty-sixth identical refusal tells a reader nothing the
 * first did not.
 *
 * The caller holds the lock — this is called from every worker.
 */
func (t *writeTally) note(kind string, err error, label string) {
	t.requests++
	if err != nil {
		t.failureCount++
		if len(t.failures) < maxReportedFailures {
			t.failures = append(t.failures, fmt.Sprintf("%s %s: %v", kind, label, err))
		}
		return
	}
	switch kind {
	case "create":
		t.created++
	case "update":
		t.updated++
	case "deactivate":
		t.deactivated++
	case "delete":
		t.deleted++
	}
}

/**
 * applyPlan sends the difference, `Concurrency` requests at a time.
 *
 * One mutex around the tally rather than channels: every worker's contribution
 * is a counter bump and an occasional append, so the lock is held for
 * nanoseconds and the alternative is a fan-in for no benefit.
 */
func applyPlan(ctx context.Context, client *http.Client, w syncWrite) writeTally {
	var (
		mu    sync.Mutex
		tally writeTally
		wg    sync.WaitGroup
	)
	slots := make(chan struct{}, w.opts.Concurrency)

	record := func(kind string, err error, label string) {
		mu.Lock()
		defer mu.Unlock()
		tally.note(kind, err, label)
	}

	run := func(kind, label string, do func() error) {
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			record(kind, do(), label)
		}()
	}

	for _, u := range w.plan.create {
		run("create", u.UserName, func() error {
			_, err := scimCreate(ctx, client, scimPost{
				URL: w.base + "/Users", Token: w.token, Resource: scimUserResource(u),
			})
			return err
		})
	}
	for _, planned := range w.plan.update {
		run("update", planned.user.UserName, func() error {
			return scimReplace(ctx, client, scimPut{
				URL:      w.base + "/Users/" + planned.targetID,
				Token:    w.token,
				Resource: scimUserResource(planned.user),
			})
		})
	}
	for _, gone := range w.plan.depart {
		if w.opts.Mode == SyncDelete {
			run("delete", gone.userName, func() error {
				return scimDelete(ctx, client, scimTarget{
					URL: w.base + "/Users/" + gone.id, Token: w.token,
				})
			})
			continue
		}
		run("deactivate", gone.userName, func() error {
			return scimDeactivate(ctx, client, scimTarget{
				URL: w.base + "/Users/" + gone.id, Token: w.token,
			})
		})
	}

	wg.Wait()
	sort.Strings(tally.failures)
	return tally
}
