package apidiff

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

// sharedSeedFile records the isolated projects and organizations already
// seeded on a shared stack, so a second lane reuses them instead of seeding
// its own. It lives beside the run directories, under SeedDir.
const (
	sharedSeedFile = "shared-seed.json"
	sharedSeedLock = "shared-seed.lock"
)

type shardRecord struct {
	ProjectKey string            `json:"projectKey,omitempty"`
	OrgKey     string            `json:"orgKey,omitempty"`
	Restricted string            `json:"restricted,omitempty"`
	Vars       map[string]string `json:"vars"`
}

type stackRecord struct {
	Shared   *shardRecord  `json:"shared,omitempty"`
	Projects []shardRecord `json:"projects"`
	Orgs     []shardRecord `json:"orgs"`
}

type sharedRecord struct {
	Stacks map[string]stackRecord `json:"stacks"`
}

func (runner *scenarioRunner) shardFromRecord(record shardRecord) *shardContext {
	shard := &shardContext{keys: runner.options.Keys, restricted: record.Restricted, vars: record.Vars}
	shard.keys.ProjectKey = record.ProjectKey
	if record.OrgKey != "" {
		shard.keys.OrgKey = record.OrgKey
	}
	return shard
}

func recordOfShard(shard *shardContext, org bool) shardRecord {
	record := shardRecord{ProjectKey: shard.keys.ProjectKey, Restricted: shard.restricted, Vars: shard.vars}
	if org {
		record.OrgKey = shard.keys.OrgKey
	}
	return record
}

// lockFile holds a named flock under dir for one lane at a time; the lock
// goes with the process, or when the returned func runs.
func lockFile(dir, name, waiting string, progress func(string)) (func(), error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR, 0o600) // #nosec G304 -- the tool's own run directory.
	if err != nil {
		return nil, err
	}
	if syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		progress(waiting)
		if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
			_ = file.Close()
			return nil, err
		}
	}
	return func() { _ = file.Close() }, nil
}

func loadSharedRecord(path string) sharedRecord {
	record := sharedRecord{Stacks: map[string]stackRecord{}}
	if content, err := os.ReadFile(path); err == nil { // #nosec G304 -- the tool's own seed record.
		_ = json.Unmarshal(content, &record)
	}
	if record.Stacks == nil {
		record.Stacks = map[string]stackRecord{}
	}
	return record
}

func saveSharedRecord(path string, record sharedRecord) error {
	encoded, err := json.MarshalIndent(record, "", " ")
	if err != nil {
		return err
	}
	staging := path + ".partial"
	if err := os.WriteFile(staging, encoded, 0o600); err != nil {
		return err
	}
	return os.Rename(staging, path)
}

// seedShared seeds the one stack under the lock: every shard the record holds
// that still authenticates is reused, the missing ones are made, and the
// record is written back before any scenario runs.
func (runner *scenarioRunner) seedShared(needs scenarioNeeds) {
	side := runner.sides[0]
	say := func(text string) { fmt.Fprintln(runner.options.Progress, text) }
	unlock, err := lockFile(runner.options.SeedDir, sharedSeedLock, "scenarios: another lane is seeding the shared stack; waiting", say)
	if err != nil {
		side.projects, side.orgs = failedShards(needs, "seed lock: "+err.Error())
		return
	}
	defer unlock()
	path := filepath.Join(runner.options.SeedDir, sharedSeedFile)
	record := loadSharedRecord(path)
	stack := record.Stacks[side.baseURL]
	stack.Shared = runner.toolOrg(side, stack.Shared)
	side.projects = runner.liveShards(side, stack.Projects, false)
	side.orgs = runner.liveShards(side, stack.Orgs, true)
	runner.topUp(side, needs)
	side.projects, side.orgs = side.projects[:needs.projects], side.orgs[:needs.orgs]
	if needs.restricted {
		runner.seedRestricted()
	}
	record.Stacks[side.baseURL] = stackRecord{Shared: stack.Shared, Projects: recordsOf(side.projects, false), Orgs: recordsOf(side.orgs, true)}
	if err := saveSharedRecord(path, record); err != nil {
		say("scenarios: the seed record was not saved: " + err.Error())
	}
}

func failedShards(needs scenarioNeeds, reason string) ([]*shardContext, []*shardContext) {
	build := func(count int) []*shardContext {
		shards := make([]*shardContext, count)
		for index := range shards {
			shards[index] = &shardContext{err: reason}
		}
		return shards
	}
	return build(needs.projects), build(needs.orgs)
}

func recordsOf(shards []*shardContext, org bool) []shardRecord {
	records := make([]shardRecord, 0, len(shards))
	for _, shard := range shards {
		if shard.err == "" {
			records = append(records, recordOfShard(shard, org))
		}
	}
	return records
}

// liveShards rebuilds the recorded shards whose key still authenticates.
func (runner *scenarioRunner) liveShards(side *scenarioSide, records []shardRecord, org bool) []*shardContext {
	shards := make([]*shardContext, len(records))
	alive := make([]bool, len(records))
	var group sync.WaitGroup
	for index := range records {
		shards[index] = runner.shardFromRecord(records[index])
		group.Add(1)
		go func() { defer group.Done(); alive[index] = runner.shardAnswers(side, shards[index], org) }()
	}
	group.Wait()
	live := shards[:0]
	for index, shard := range shards {
		if alive[index] {
			live = append(live, shard)
		}
	}
	return live
}

func (runner *scenarioRunner) shardAnswers(side *scenarioSide, shard *shardContext, org bool) bool {
	path, headers := "/api/dataset", map[string]string{"X-Auth-Token": shard.keys.ProjectKey}
	if org {
		path, headers = "/api/projects", bearerHeader(shard.keys.OrgKey)
	}
	result := runner.engine.fixtureRequest(fixtureCall{method: http.MethodGet, url: side.baseURL + path, headers: headers})
	return result.status == http.StatusOK
}

// topUp makes the shards the record lacks, in parallel, and appends them.
func (runner *scenarioRunner) topUp(side *scenarioSide, needs scenarioNeeds) {
	missingProjects, missingOrgs := max(needs.projects-len(side.projects), 0), max(needs.orgs-len(side.orgs), 0)
	made := make([]*shardContext, missingProjects+missingOrgs)
	var group sync.WaitGroup
	for index := range made {
		group.Add(1)
		go func() {
			defer group.Done()
			if index < missingProjects {
				made[index] = runner.seedProject(side, len(side.projects)+index)
				return
			}
			made[index] = runner.seedOrg(side, runner.orgName(len(side.orgs)+index-missingProjects))
		}()
	}
	group.Wait()
	side.projects = append(side.projects, made[:missingProjects]...)
	side.orgs = append(side.orgs, made[missingProjects:]...)
}

// toolOrgName is the organization apidiff owns on a shared stack.
const toolOrgName = "apidiff"

// toolOrg makes (or finds again) the organization the shared stack gives
// apidiff, with a project of its own, and makes it the side's shared shard.
// Without the instance admin key it cannot, and the seeded organization stays.
func (runner *scenarioRunner) toolOrg(side *scenarioSide, recorded *shardRecord) *shardRecord {
	if runner.options.Keys.AdminKey == "" {
		fmt.Fprintln(runner.options.Progress, "scenarios: no -admin-key, so no isolated apidiff organization is provisioned; the seeded organization is used")
		return nil
	}
	if recorded != nil {
		shard := runner.shardFromRecord(*recorded)
		if runner.shardAnswers(side, shard, true) && runner.shardAnswers(side, shard, false) {
			side.shared = shard
			return recorded
		}
	}
	shard := runner.seedOrg(side, toolOrgName+"-"+runner.tag)
	if shard.err != "" {
		side.shared = &shardContext{err: "apidiff organization: " + shard.err}
		return nil
	}
	side.shared = shard
	record := recordOfShard(shard, true)
	return &record
}
