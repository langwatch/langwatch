package seedgen

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"iter"
	"math"
	"slices"
	"strconv"
	"time"
)

// Plan is the seed's skeleton (orgs, projects, users) plus a lazy telemetry stream; the stream is
// never materialized (design §5.1).
type Plan struct {
	Flags  Flags
	Run    string
	Orgs   []*Org
	draws  Draws
	hours  int
	start  time.Time
	totals []float64
	// conversations per project actually planned: none when the span budget cannot hold them.
	conversations int
}

// Org is one seeded organization. A private org is not created by the plan: storage-seed writes it
// with a fixed id before boot (Q3 ruling (b)), and the executor binds its Ref from that id.
type Org struct {
	Persona  string
	Ref, Key string
	Name     string
	Plan     string // "licence" seeds an Enterprise licence; anything else leaves the product's default
	Private  bool
	Projects []*Project
	Users    []User
	curve    Curve
}

// Project is one project and its share of the telemetry.
type Project struct {
	Org      *Org
	Ref, Key string
	Spans    int
}

// User is one member of an org; the first is its owner.
type User struct {
	Ref, Email, Role, State string
}

// NewPlan validates the flags and builds the plan's skeleton.
func NewPlan(flags Flags) (*Plan, error) {
	flags, err := flags.withDefaults()
	if err != nil {
		return nil, err
	}
	tier, _ := TierNamed(flags.Size)
	encoded, _ := json.Marshal(flags)
	sum := sha256.Sum256(append([]byte(Recipe+"\x00"), encoded...))
	plan := &Plan{Flags: flags, Run: hex.EncodeToString(sum[:6]), draws: Draws{Seed: flags.Seed},
		hours: flags.Days * 24, start: flags.Anchor.Add(-time.Duration(flags.Days) * 24 * time.Hour)}
	switch {
	case flags.Into != "":
		into := plan.newOrg(flags.Personas[0], "into", false)
		plan.fill(into, 1, 0)
		plan.Orgs = []*Org{into}
		plan.allocate()
		return plan, nil
	case len(flags.Orgs) > 0:
		for _, spec := range flags.Orgs {
			org := plan.newOrg(spec.Persona, spec.Name, false)
			org.Key, org.Plan = spec.Name, spec.Plan // the org is named as asked; its users' emails derive from the name
			plan.fill(org, 1, spec.Users)
			if spec.Owner != "" {
				org.Users[0].Email = spec.Owner
			}
			plan.Orgs = append(plan.Orgs, org)
		}
	default:
		plan.Orgs = plan.sharedOrgs(tier)
	}
	for n := 1; n <= flags.Private; n++ {
		org := plan.newOrg(flags.Personas[(n-1)%len(flags.Personas)], "private-"+strconv.Itoa(n), true)
		plan.fill(org, 1, 3)
		plan.Orgs = append(plan.Orgs, org)
	}
	plan.allocate()
	return plan, nil
}

// sharedOrgs deals the tier's orgs round-robin over all four personas, gives a startup org one
// project and three users (design §7.1), spreads the rest, then keeps the selected personas.
func (p *Plan) sharedOrgs(tier Tier) []*Org {
	orgs := make([]*Org, tier.Orgs)
	perPersona := map[string]int{}
	var rest []*Org
	projects, users := tier.Projects, tier.Users
	for i := range orgs {
		persona := Personas[i%len(Personas)]
		perPersona[persona]++
		orgs[i] = p.newOrg(persona, persona+"-"+strconv.Itoa(perPersona[persona]), false)
		if persona == "startup" {
			p.fill(orgs[i], 1, 3)
			projects, users = projects-1, users-3
		} else {
			rest = append(rest, orgs[i])
		}
	}
	projectCounts, userCounts := make([]int, len(rest)), make([]int, len(rest))
	for i := range projects {
		projectCounts[i%len(rest)]++
	}
	for i := range users {
		userCounts[i%len(rest)]++
	}
	for i, org := range rest {
		p.fill(org, projectCounts[i], userCounts[i])
	}
	return slices.DeleteFunc(orgs, func(org *Org) bool { return !slices.Contains(p.Flags.Personas, org.Persona) })
}

func (p *Plan) newOrg(persona, name string, private bool) *Org {
	return &Org{Persona: persona, Ref: "$org:" + name, Key: fmt.Sprintf("s%d-%s", p.Flags.Seed, name),
		Name: name, Private: private}
}

var projectNames = map[string]string{"startup": "support", "enterprise": "platform", "gateway": "gateway",
	"agent-eval": "agents"}

// fill adds the org's projects and users: owner, then accepted members, the last one invited.
func (p *Plan) fill(org *Org, projects, users int) {
	for i := 1; i <= projects; i++ {
		key := projectNames[org.Persona]
		if org.Persona != "startup" {
			key += "-" + strconv.Itoa(i)
		}
		org.Projects = append(org.Projects, &Project{Org: org, Ref: "$project:" + org.Name + "/" + key, Key: key})
	}
	for i := 1; i <= users; i++ {
		user := User{Ref: fmt.Sprintf("$user:%s/u%d", org.Name, i), Email: fmt.Sprintf("%s.u%d@seed.test", org.Key, i),
			Role: []string{"MEMBER", "VIEWER"}[i%2], State: "accepted"}
		switch {
		case i == 1:
			user.Ref, user.Role = "$user:"+org.Name+"/owner", "ADMIN"
		case i == users && users >= 3:
			user.State = "invited"
		}
		org.Users = append(org.Users, user)
	}
}

// allocate keeps the conversations' spans aside, splits the rest over projects by drawn weights
// and sums each project's hourly curve.
func (p *Plan) allocate() {
	var projects []*Project
	for i, org := range p.Orgs {
		org.curve = newCurve(p.draws, int64(i), p.Flags.Days)
		projects = append(projects, org.Projects...)
	}
	budget := p.Flags.Spans
	p.conversations = p.Flags.Conversations
	if reserved := len(projects) * p.conversations * p.Flags.Turns * conversationSpans; 2*reserved <= budget {
		budget -= reserved
	} else {
		p.conversations = 0 // shortcut: a budget too small for them seeds none, rather than fewer turns
	}
	weights := make([]float64, len(projects))
	for i := range projects {
		weights[i] = 0.5 + 1.5*p.draws.Float("project", int64(i), "weight")
	}
	split(budget, weights, func(i, n int) { projects[i].Spans = n })
	p.totals = make([]float64, len(projects))
	for i, project := range projects {
		for hour := range p.hours {
			p.totals[i] += p.hourWeight(i, project, hour)
		}
	}
}

// split deals total over weights exactly: each share is the floor of the cumulative share.
func split(total int, weights []float64, give func(i, n int)) {
	var sum, cum float64
	for _, w := range weights {
		sum += w
	}
	done := 0
	for i, w := range weights {
		cum += w
		target := total
		if i < len(weights)-1 {
			target = min(total, int(math.Floor(float64(total)*cum/sum)))
		}
		give(i, target-done)
		done = target
	}
}

func (p *Plan) hourWeight(index int, project *Project, hour int) float64 {
	at := p.start.Add(time.Duration(hour) * time.Hour)
	jitter := 0.8 + 0.4*p.draws.Float("hour", int64(index)*int64(p.hours)+int64(hour), "jitter")
	return project.Org.curve.Weight(at, hour/24) * jitter
}

// RetentionDays is the smallest retention ≥ days + 14 the persona's plan accepts (design §6.2):
// any whole week ≥ 49 on enterprise, else the paid presets 35 and 63.
func RetentionDays(persona string, days int) int {
	need := days + 14
	if persona == "enterprise" {
		return max(49, (need+6)/7*7)
	}
	for _, preset := range []int{35, 63} {
		if preset >= need {
			return preset
		}
	}
	return (need + 6) / 7 * 7
}

// Steps is the lazy stream: each org's identity and retention first, then telemetry hour by hour
// with tenants interleaved.
func (p *Plan) Steps() iter.Seq[Step] {
	return func(yield func(Step) bool) {
		walk := &walker{plan: p, yield: yield}
		_ = walk.identity() && walk.telemetry() && walk.conversations()
	}
}

// walker numbers the steps it yields; each walk stops when yield does.
type walker struct {
	plan  *Plan
	yield func(Step) bool
	seq   int64
}

func (w *walker) emit(step Step) bool {
	w.seq++
	step.Seq = w.seq
	if step.Action != nil {
		step.Action.ID = w.plan.Run + "/" + strconv.FormatInt(w.seq, 10)
	}
	return w.yield(step)
}

// identity creates nothing under --into: the org and project already exist.
func (w *walker) identity() bool {
	if w.plan.Flags.Into != "" {
		return true
	}
	if admin := w.plan.Flags.Admin; admin != "" {
		action := Action{Kind: KindUserCreate, Ref: AdminRef, Key: admin,
			Input: inputOf(map[string]any{"email": admin, "role": "ADMIN", "state": "accepted"})}
		if !w.emit(Step{Action: &action}) {
			return false
		}
	}
	for _, org := range w.plan.Orgs {
		actions := org.actions(w.plan.Flags.Days, w.plan.Flags.Admin != "")
		for i := range actions {
			if !w.emit(Step{Action: &actions[i]}) {
				return false
			}
		}
	}
	return true
}

func (w *walker) telemetry() bool {
	stream := w.plan.newTelemetry()
	for hour := range w.plan.hours {
		for i := range stream.projects {
			if cell, ok := stream.cell(i, hour); ok && !w.emit(Step{Cell: &cell}) {
				return false
			}
		}
	}
	return true
}

// conversationSpans is the spans of one turn (telemetrysim's conversation-turn preset).
const conversationSpans = 2

// conversations emits each project's long threads, one cell each, on the days before the anchor
// at 14:00, every turn a trace sharing the thread's gen_ai.conversation.id.
func (w *walker) conversations() bool {
	plan := w.plan
	for _, org := range plan.Orgs {
		for _, project := range org.Projects {
			for k := range plan.conversations {
				day := plan.Flags.Days - 1 - k%plan.Flags.Days
				spans := plan.Flags.Turns * conversationSpans
				cell := Cell{Persona: org.Persona, Org: org.Ref, Project: project.Ref, Private: org.Private,
					Start: plan.start.Add(time.Duration(day)*24*time.Hour + 14*time.Hour),
					Spans: spans, Logs: spans, MetricPoints: 2 * spans, Turns: plan.Flags.Turns,
					Thread: fmt.Sprintf("s%d-%s-%s-conversation-%d", plan.Flags.Seed, org.Key, project.Key, k+1)}
				if !w.emit(Step{Cell: &cell}) {
					return false
				}
			}
		}
	}
	return true
}

// telemetry deals each project's spans over the hours as the floor of its cumulative curve.
type telemetry struct {
	plan     *Plan
	projects []*Project
	cum      []float64
	done     []int
}

func (p *Plan) newTelemetry() *telemetry {
	stream := &telemetry{plan: p}
	for _, org := range p.Orgs {
		stream.projects = append(stream.projects, org.Projects...)
	}
	stream.cum, stream.done = make([]float64, len(stream.projects)), make([]int, len(stream.projects))
	return stream
}

func (t *telemetry) cell(i, hour int) (Cell, bool) {
	project, plan := t.projects[i], t.plan
	t.cum[i] += plan.hourWeight(i, project, hour)
	target := project.Spans
	if hour < plan.hours-1 {
		target = min(project.Spans, int(math.Floor(float64(project.Spans)*t.cum[i]/plan.totals[i])))
	}
	spans := target - t.done[i]
	t.done[i] = target
	return Cell{Persona: project.Org.Persona, Org: project.Org.Ref, Project: project.Ref,
		Private: project.Org.Private, Start: plan.start.Add(time.Duration(hour) * time.Hour),
		Spans: spans, Logs: spans, MetricPoints: 2 * spans}, spans > 0
}

// AdminRef is the seeded admin's ref: one account, a member of every org the seed creates.
const AdminRef = "$user:admin"

// orgRoles maps a plan role to the member row's role; a viewer holds a Lite (EXTERNAL) seat.
var orgRoles = map[string]string{"ADMIN": "ADMIN", "MEMBER": "MEMBER", "VIEWER": "EXTERNAL"}

// TeamRef is the ref org.create mints for the team the product founds with the org.
func (org *Org) TeamRef() string { return "$team:" + org.Name + "/main" }

// actions are the org's identity steps, retention before any data in the org. The owner founds
// the org (and its main team); every other accepted user, and the admin, is admitted by the owner.
func (org *Org) actions(days int, withAdmin bool) []Action {
	owner := org.Users[0]
	var actions []Action
	if org.Private {
		actions = append(actions, userAction(owner))
	} else {
		actions = append(actions, userAction(owner),
			Action{Kind: KindOrgCreate, Ref: org.Ref, As: owner.Ref, Key: org.Key,
				Input: inputOf(map[string]any{"name": org.Key, "persona": org.Persona, "team": "main"})})
	}
	if org.Plan == "licence" {
		actions = append(actions, Action{Kind: KindLicenseIssue, Org: org.Ref, As: owner.Ref, Key: org.Key,
			Input: inputOf(map[string]any{"name": org.Key, "email": owner.Email})})
	}
	actions = append(actions,
		Action{Kind: KindRetentionSet, Org: org.Ref, As: owner.Ref, Key: org.Key,
			Input: inputOf(map[string]any{"days": RetentionDays(org.Persona, days)})})
	for _, project := range org.Projects {
		actions = append(actions, Action{Kind: KindProjectCreate, Ref: project.Ref, Org: org.Ref, As: owner.Ref,
			Key: project.Key, Input: inputOf(map[string]any{"name": project.Key, "team": org.TeamRef()})})
	}
	for _, user := range org.Users[1:] {
		actions = append(actions, userAction(user))
	}
	for _, user := range org.Users[1:] {
		if user.State == "accepted" {
			actions = append(actions, memberAction(org, user.Ref, user.Email, user.Role, owner.Ref))
		}
	}
	if withAdmin {
		actions = append(actions, memberAction(org, AdminRef, "admin", "ADMIN", owner.Ref))
	}
	return actions
}

// memberAction admits a user to the org with its role, and to the main team, as the owner.
func memberAction(org *Org, user, key, role, as string) Action {
	return Action{Kind: KindMemberAdd, Org: org.Ref, As: as, Key: key, Input: inputOf(map[string]any{
		"user": user, "role": orgRoles[role], "team": org.TeamRef(), "teamRole": role})}
}

func userAction(user User) Action {
	return Action{Kind: KindUserCreate, Ref: user.Ref, Key: user.Email,
		Input: inputOf(map[string]any{"email": user.Email, "role": user.Role, "state": user.State})}
}

func inputOf(fields map[string]any) json.RawMessage {
	encoded, _ := json.Marshal(fields)
	return encoded
}

// Digest is the sha256 of the whole stream; two plans with the same flags share it.
func (p *Plan) Digest() string {
	hash := sha256.New()
	encoder := json.NewEncoder(hash)
	for step := range p.Steps() {
		_ = encoder.Encode(step)
	}
	return hex.EncodeToString(hash.Sum(nil))
}
