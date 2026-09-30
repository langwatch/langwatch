package apidiff

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
)

// Under SaaS the instance-admin routes answer 404 before any credential is
// read (instanceAdminDoor), so the admin key is unusable: the run drops it,
// seeds through the no-key path, and defers the scenarios that need it.

// probeAdminKey drops the admin key when a side answers 404 to it, and says
// so once. A side that did not answer, or refused the key, keeps it.
func (runner *scenarioRunner) probeAdminKey() {
	key := runner.options.Keys.AdminKey
	if key == "" {
		return
	}
	statuses := make([]int, len(runner.sides))
	var group sync.WaitGroup
	for index, side := range runner.sides {
		group.Add(1)
		go func() {
			defer group.Done()
			statuses[index] = runner.call(side, http.MethodGet, "/api/organizations", key, nil).status
		}()
	}
	group.Wait()
	var absent []string
	for index, side := range runner.sides {
		if statuses[index] == http.StatusNotFound {
			absent = append(absent, side.name)
		}
	}
	if len(absent) == 0 {
		return
	}
	fmt.Fprintf(runner.options.Progress, "scenarios: instance-admin routes answer 404 on %s (SaaS): running without the admin key; scenarios needing it are deferred to the self-hosted pass\n", strings.Join(absent, " and "))
	runner.options.Keys.AdminKey = ""
	runner.adminAbsent = true
	for _, side := range runner.sides {
		side.shared.keys.AdminKey = ""
	}
}

// needsInstanceAdmin is true for a scenario that can only run where the
// instance-admin key works: an admin-auth request, or an organization it
// makes for itself or for a foreign tenant.
func needsInstanceAdmin(item *scenario, keys Keys) bool {
	if item.Shard == shardOrg {
		return true
	}
	for _, kind := range []string{authAdmin, authOrgC, authOrgCOrg} {
		if usesAuth(item, kind) {
			return true
		}
	}
	return keys.ProjectKeyC == "" && usesAuth(item, authProjectC)
}

// deferAdminScenarios splits off the scenarios the self-hosted pass owns; it
// keeps them all when the admin key was not found absent.
func (runner *scenarioRunner) deferAdminScenarios(items []scenario) (kept []scenario, deferred []string) {
	if !runner.adminAbsent {
		return items, nil
	}
	for index := range items {
		if needsInstanceAdmin(&items[index], runner.options.Keys) {
			deferred = append(deferred, items[index].ID)
		} else {
			kept = append(kept, items[index])
		}
	}
	sort.Strings(deferred)
	return kept, deferred
}

// writeDeferred lists the scenarios left for the self-hosted pass. They are
// neither passes nor failures, and the tally line does not count them.
func writeDeferred(out io.Writer, deferred []string) {
	if len(deferred) == 0 {
		return
	}
	fmt.Fprintf(out, "scenarios: %d deferred: self-hosted pass (instance-admin key unusable under SaaS): %s\n", len(deferred), strings.Join(deferred, ", "))
}
