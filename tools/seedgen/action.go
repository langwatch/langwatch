package seedgen

import "time"

// Action kinds the plan core emits; persona lanes add their config kinds.
const (
	KindUserCreate    = "user.create"
	KindOrgCreate     = "org.create"
	KindRetentionSet  = "retention.set"
	KindTeamCreate    = "team.create"
	KindProjectCreate = "project.create"
	KindGrantAttach   = "grant.attach"
)

// Kinds lists every action kind the plan emits; coverage.json may name only these.
var Kinds = []string{KindUserCreate, KindOrgCreate, KindRetentionSet, KindTeamCreate, KindProjectCreate,
	KindGrantAttach, KindTraceOTLP, KindLogOTLP, KindMetricOTLP}

// GrantAttachInput is grant.attach's input, as the runner's grantAttachSchema reads it.
type GrantAttachInput struct {
	Grants []Grant `json:"grants"`
}

// Grant is one grant to attach; Principal holds exactly one of userId, groupId or apiKeyId.
type Grant struct {
	Principal    map[string]string `json:"principal"`
	Role         string            `json:"role"`
	ScopeType    string            `json:"scopeType"`
	ScopeID      string            `json:"scopeId"`
	CustomRoleID string            `json:"customRoleId,omitempty"`
	ExpiresAtMs  int64             `json:"expiresAtMs,omitempty"`
}

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
