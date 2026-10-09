package seedgen

import "time"

// Action kinds the plan core emits; persona lanes add their config kinds.
const (
	KindUserCreate    = "user.create"
	KindOrgCreate     = "org.create"
	KindRetentionSet  = "retention.set"
	KindTeamCreate    = "team.create"
	KindProjectCreate = "project.create"
)

// Kinds lists every action kind the plan emits; coverage.json may name only these.
var Kinds = []string{KindUserCreate, KindOrgCreate, KindRetentionSet, KindTeamCreate, KindProjectCreate}

// Step is one item of the plan stream: an action for the runner, or a telemetry cell the chunker
// turns into trace, log and metric chunks with ids "<run>/<seq>.<chunk>".
type Step struct {
	Seq    int64   `json:"seq"`
	Action *Action `json:"action,omitempty"`
	Cell   *Cell   `json:"cell,omitempty"`
}

// Cell is one project's telemetry for one business hour.
type Cell struct {
	Persona      string    `json:"persona"`
	Org          string    `json:"org"`
	Project      string    `json:"project"`
	Private      bool      `json:"private,omitempty"`
	Start        time.Time `json:"start"`
	Spans        int       `json:"spans"`
	Logs         int       `json:"logs"`
	MetricPoints int       `json:"metricPoints"`
}
