package seed

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// User states the S tier holds (plan section 2.2).
const (
	UserActive      = "active"
	UserDeactivated = "deactivated"
	UserUnconfirmed = "unconfirmed"
	UserNeverSigned = "never-signed-in"
)

var (
	userStates = []string{UserActive, UserDeactivated, UserUnconfirmed, UserNeverSigned}
	paidPlans  = []string{"LAUNCH", "ACCELERATE", "GROWTH_SEAT_USD_MONTHLY", "ENTERPRISE"}
)

// TenancyInput is what tenancy rows derive from; Cloud adds subscription rows and main's user columns.
type TenancyInput struct {
	Shape  string
	Seed   int64
	Anchor time.Time
	Cloud  bool
}

// Tenancy is the S tier's organizations, teams, projects and users, ids snap_<cell>_<kind>_<n>.
type Tenancy struct {
	Cell          string
	Organizations []Organization
	Teams         []Team
	Projects      []Project
	Users         []User
	Subscriptions []Subscription
	withVerified  bool
}

// Organization is one tenant organization row.
type Organization struct {
	ID, Name, Slug string
	CreatedAt      time.Time
}

// Team is one team row; a personal team has an owner user.
type Team struct {
	ID, Name, Slug, OrganizationID, OwnerUserID string
	Personal                                    bool
	CreatedAt                                   time.Time
}

// Project is one project row carrying its test API key.
type Project struct {
	ID, Name, Slug, APIKey, TeamID, OwnerUserID string
	Personal, Archived                          bool
	CreatedAt                                   time.Time
}

// User is one user row in one of the four states.
type User struct {
	ID, Name, Email, State, OrganizationID, Role string
	CreatedAt                                    time.Time
}

// Subscription is one ACTIVE paid subscription row (cloud shapes only).
type Subscription struct {
	ID, OrganizationID, Plan string
	StartDate                time.Time
}

// PickParams are the three things a draw derives from, and its range [0, N).
type PickParams struct {
	Seed  int64
	Kind  string
	Index int
	N     int
}

// Pick derives a value in [0, N) from (seed, kind, index) alone, so no draw depends on another.
func Pick(params PickParams) int {
	sum := sha256.Sum256(fmt.Appendf(nil, "%d/%s/%d", params.Seed, params.Kind, params.Index))
	return int(binary.BigEndian.Uint64(sum[:8]) % uint64(params.N))
}

// tenancyBuilder holds what every row's id and timestamp derive from.
type tenancyBuilder struct {
	input    TenancyInput
	cell     string
	start    time.Time
	orgCount int
}

func (builder tenancyBuilder) id(kind string, n int) string {
	return fmt.Sprintf("snap_%s_%s_%d", builder.cell, kind, n)
}

func (builder tenancyBuilder) instant(kind string, n int) time.Time {
	minutes := int(builder.input.Anchor.Sub(builder.start) / time.Minute)
	return builder.start.Add(time.Duration(Pick(PickParams{builder.input.Seed, kind + "/at", n, minutes})) * time.Minute)
}

func (builder tenancyBuilder) pick(kind string, n, size int) int {
	return Pick(PickParams{Seed: builder.input.Seed, Kind: kind, Index: n, N: size})
}

// BuildTenancy lays out the S tier: 3 organizations (hybrid 4), 6 teams, 12 projects, 40 users.
func BuildTenancy(input TenancyInput) Tenancy {
	builder := tenancyBuilder{input: input, cell: strings.ReplaceAll(input.Shape, "-", ""), start: input.Anchor.AddDate(0, -1, 0), orgCount: 3}
	if input.Shape == "hybrid" {
		builder.orgCount = 4
	}
	tenancy := Tenancy{Cell: builder.cell, withVerified: input.Cloud}
	tenancy.Organizations = builder.organizations()
	if input.Cloud {
		tenancy.Subscriptions = builder.subscriptions()
	}
	tenancy.Users = builder.users()
	tenancy.Teams = builder.teams()
	tenancy.Projects = builder.projects(tenancy.Teams)
	return tenancy
}

func (builder tenancyBuilder) organizations() []Organization {
	var organizations []Organization
	for n := 1; n <= builder.orgCount; n++ {
		organizations = append(organizations, Organization{
			ID: builder.id("org", n), Name: fmt.Sprintf("Snapshot Org %d", n), Slug: fmt.Sprintf("snap-%s-org-%d", builder.cell, n), CreatedAt: builder.instant("org", n),
		})
	}
	return organizations
}

func (builder tenancyBuilder) subscriptions() []Subscription {
	var subscriptions []Subscription
	for n := 1; n <= builder.orgCount; n++ {
		subscriptions = append(subscriptions, Subscription{
			ID: builder.id("sub", n), OrganizationID: builder.id("org", n), Plan: paidPlans[builder.pick("sub", n, len(paidPlans))], StartDate: builder.instant("sub", n),
		})
	}
	return subscriptions
}

func (builder tenancyBuilder) users() []User {
	var users []User
	for n := 1; n <= 40; n++ {
		state := userStates[(n-1)%len(userStates)]
		if n > len(userStates) {
			state = userStates[builder.pick("user", n, len(userStates))]
		}
		role := "MEMBER"
		if n <= builder.orgCount || builder.pick("role", n, 5) == 0 {
			role = "ADMIN"
		}
		users = append(users, User{
			ID: builder.id("user", n), Name: fmt.Sprintf("Snapshot User %d", n), Email: fmt.Sprintf("user%d@snapshot.test", n),
			State: state, OrganizationID: builder.id("org", (n-1)%builder.orgCount+1), Role: role, CreatedAt: builder.instant("user", n),
		})
	}
	return users
}

func (builder tenancyBuilder) teams() []Team {
	var teams []Team
	for n := 1; n <= 6; n++ {
		org := (n-1)%builder.orgCount + 1
		team := Team{ID: builder.id("team", n), Name: fmt.Sprintf("Snapshot Team %d", n), Slug: fmt.Sprintf("snap-%s-team-%d", builder.cell, n),
			OrganizationID: builder.id("org", org), CreatedAt: builder.instant("team", n)}
		if n%3 == 0 {
			team.Personal, team.OwnerUserID = true, builder.id("user", org)
		}
		teams = append(teams, team)
	}
	return teams
}

func (builder tenancyBuilder) projects(teams []Team) []Project {
	var projects []Project
	for n := 1; n <= 12; n++ {
		team := &teams[(n-1)%len(teams)]
		projects = append(projects, Project{
			ID: builder.id("project", n), Name: fmt.Sprintf("Snapshot Project %d", n), Slug: fmt.Sprintf("snap-%s-project-%d", builder.cell, n),
			APIKey: fmt.Sprintf("sk-lw-snapshot-test-%s-%d", builder.cell, n), TeamID: team.ID, OwnerUserID: team.OwnerUserID,
			Personal: team.Personal, Archived: n%5 == 0, CreatedAt: builder.instant("project", n),
		})
	}
	return projects
}

// APIKeys are the projects' test keys: the scrubber's allow list and the traffic doors' credentials.
func (tenancy Tenancy) APIKeys() []string {
	keys := make([]string, 0, len(tenancy.Projects))
	for i := range tenancy.Projects {
		keys = append(keys, tenancy.Projects[i].APIKey)
	}
	return keys
}
