package apidiff

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	runner.sessionSeeding = true
	for _, side := range runner.sides {
		side.shared.keys.AdminKey = ""
		if side.creds[credSessionCookie] == "" && !runner.engine.signInAdmin(side.baseURL, side.creds) {
			runner.sessionSeeding = false
		}
	}
	if runner.sessionSeeding {
		fmt.Fprintln(runner.options.Progress, "scenarios: seeding second organizations through the seeded admin's session")
	}
}

// needsInstanceAdmin is true for a scenario that can only run where the
// instance-admin key works: an admin-auth request or one marked selfHosted.
// Without a session to seed with, so is one that makes an organization for
// itself or for a foreign tenant.
func needsInstanceAdmin(item *scenario, keys Keys, sessionSeeding bool) bool {
	if item.SelfHosted || usesAuth(item, authAdmin) {
		return true
	}
	if sessionSeeding {
		return false
	}
	if item.Shard == shardOrg || usesAuth(item, authOrgC) || usesAuth(item, authOrgCOrg) {
		return true
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
		if needsInstanceAdmin(&items[index], runner.options.Keys, runner.sessionSeeding) {
			deferred = append(deferred, items[index].ID)
		} else {
			kept = append(kept, items[index])
		}
	}
	sort.Strings(deferred)
	return kept, deferred
}

// countSaaSDeferred is how many of items a SaaS run defers when the seeded
// admin's session can make the second organizations.
func countSaaSDeferred(items []scenario, keys Keys) int {
	count := 0
	for index := range items {
		if needsInstanceAdmin(&items[index], keys, true) {
			count++
		}
	}
	return count
}

// writeDeferred lists the scenarios left for the self-hosted pass. They are
// neither passes nor failures, and the tally line does not count them.
func writeDeferred(out io.Writer, deferred []string) {
	if len(deferred) == 0 {
		return
	}
	fmt.Fprintf(out, "scenarios: %d deferred: self-hosted pass (needs the instance-admin key or an Enterprise organization, which SaaS lacks): %s\n", len(deferred), strings.Join(deferred, ", "))
}

// deferredFile is where a run keeps its deferred ids, one per line, for the
// self-hosted pass to read back as `-scenario-id @<file>`.
const deferredFile = "deferred.txt"

// writeDeferredList writes the deferred ids into the run directory and answers
// the path, "" when there is nothing to write or nowhere to write it.
func writeDeferredList(dir string, deferred []string) (string, error) {
	if dir == "" || len(deferred) == 0 {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	target := filepath.Join(dir, deferredFile)
	return target, os.WriteFile(target, []byte(strings.Join(deferred, "\n")+"\n"), 0o600)
}

// reportDeferred prints the deferred line and keeps the list beside the run.
func reportDeferred(report, progress io.Writer, dir string, deferred []string) {
	writeDeferred(report, deferred)
	if target, err := writeDeferredList(dir, deferred); err != nil {
		fmt.Fprintln(progress, "scenarios: deferred list:", err)
	} else if target != "" {
		fmt.Fprintln(progress, "scenarios: deferred list:", target)
	}
}

// scenarioIDs is -scenario-id: a path.Match pattern, or @FILE for the ids a
// file lists one per line (a run's deferred.txt). A file listing none is an
// error, since no pattern at all would select every scenario.
type scenarioIDs []string

func (ids *scenarioIDs) String() string { return strings.Join(*ids, ",") }

func (ids *scenarioIDs) Set(value string) error {
	path, isFile := strings.CutPrefix(value, "@")
	if !isFile {
		*ids = append(*ids, value)
		return nil
	}
	body, err := os.ReadFile(path) // #nosec G304 -- a path the operator named
	if err != nil {
		return err
	}
	listed := strings.Fields(string(body))
	if len(listed) == 0 {
		return fmt.Errorf("%s lists no scenario id", path)
	}
	*ids = append(*ids, listed...)
	return nil
}
