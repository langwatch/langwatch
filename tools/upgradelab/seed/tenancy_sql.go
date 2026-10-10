package seed

import (
	"cmp"
	"fmt"
	"strings"
	"time"
)

// SQL renders the tenancy at the old schema (search_path mydb), one transaction, for psql -f -.
func (tenancy Tenancy) SQL() string {
	var out strings.Builder
	out.WriteString("\\set ON_ERROR_STOP on\nSET search_path TO mydb;\nBEGIN;\n")
	tenancy.writeUsers(&out)
	tenancy.writeOrganizations(&out)
	tenancy.writeMemberships(&out)
	tenancy.writeTeams(&out)
	tenancy.writeProjects(&out)
	out.WriteString("COMMIT;\n")
	return out.String()
}

func (tenancy Tenancy) writeUsers(out *strings.Builder) {
	for _, user := range tenancy.Users {
		lastLogin, deactivated := sqlTime(user.CreatedAt), "NULL"
		switch user.State {
		case UserNeverSigned, UserUnconfirmed:
			lastLogin = "NULL"
		case UserDeactivated:
			deactivated = sqlTime(user.CreatedAt.Add(time.Hour))
		}
		columns := `id, name, email, "createdAt", "updatedAt", "lastLoginAt", "deactivatedAt"`
		values := fmt.Sprintf("%s, %s, %s, %s, %s, %s, %s", quote(user.ID), quote(user.Name), quote(user.Email),
			sqlTime(user.CreatedAt), sqlTime(user.CreatedAt), lastLogin, deactivated)
		if tenancy.withVerified {
			columns += `, "emailVerified"`
			values += fmt.Sprintf(", %t", user.State != UserUnconfirmed)
		}
		fmt.Fprintf(out, "INSERT INTO \"User\" (%s) VALUES (%s);\n", columns, values)
	}
}

func (tenancy Tenancy) writeOrganizations(out *strings.Builder) {
	for _, org := range tenancy.Organizations {
		fmt.Fprintf(out, "INSERT INTO \"Organization\" (id, name, slug, \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, %s, %s);\n",
			quote(org.ID), quote(org.Name), quote(org.Slug), sqlTime(org.CreatedAt), sqlTime(org.CreatedAt))
	}
	for _, sub := range tenancy.Subscriptions {
		fmt.Fprintf(out, "INSERT INTO \"Subscription\" (id, \"organizationId\", plan, status, \"startDate\", \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, %s, %s, %s, %s);\n",
			quote(sub.ID), quote(sub.OrganizationID), quote(sub.Plan), quote(cmp.Or(sub.Status, "ACTIVE")), sqlTime(sub.StartDate), sqlTime(sub.StartDate), sqlTime(sub.StartDate))
	}
}

func (tenancy Tenancy) writeMemberships(out *strings.Builder) {
	for _, user := range tenancy.Users {
		fmt.Fprintf(out, "INSERT INTO \"OrganizationUser\" (\"userId\", \"organizationId\", role, \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, %s, %s);\n",
			quote(user.ID), quote(user.OrganizationID), quote(user.Role), sqlTime(user.CreatedAt), sqlTime(user.CreatedAt))
	}
}

func (tenancy Tenancy) writeTeams(out *strings.Builder) {
	for i := range tenancy.Teams {
		team := &tenancy.Teams[i]
		owner := "NULL"
		if team.Personal {
			owner = quote(team.OwnerUserID)
		}
		fmt.Fprintf(out, "INSERT INTO \"Team\" (id, name, slug, \"organizationId\", \"createdAt\", \"updatedAt\", \"isPersonal\", \"ownerUserId\") VALUES (%s, %s, %s, %s, %s, %s, %t, %s);\n",
			quote(team.ID), quote(team.Name), quote(team.Slug), quote(team.OrganizationID), sqlTime(team.CreatedAt), sqlTime(team.CreatedAt), team.Personal, owner)
		tenancy.writeTeamUsers(out, team)
	}
}

func (tenancy Tenancy) writeTeamUsers(out *strings.Builder, team *Team) {
	for _, user := range tenancy.Users {
		if user.OrganizationID == team.OrganizationID && (!team.Personal || user.ID == team.OwnerUserID) {
			fmt.Fprintf(out, "INSERT INTO \"TeamUser\" (\"userId\", \"teamId\", role, \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, %s, %s);\n",
				quote(user.ID), quote(team.ID), quote(user.Role), sqlTime(team.CreatedAt), sqlTime(team.CreatedAt))
		}
	}
}

func (tenancy Tenancy) writeProjects(out *strings.Builder) {
	for i := range tenancy.Projects {
		project := &tenancy.Projects[i]
		owner, archived := "NULL", "NULL"
		if project.Personal {
			owner = quote(project.OwnerUserID)
		}
		if project.Archived {
			archived = sqlTime(project.CreatedAt.Add(24 * time.Hour))
		}
		fmt.Fprintf(out, "INSERT INTO \"Project\" (id, name, slug, \"apiKey\", \"teamId\", language, framework, \"createdAt\", \"updatedAt\", \"archivedAt\", \"isPersonal\", \"ownerUserId\") VALUES (%s, %s, %s, %s, %s, 'python', 'openai', %s, %s, %s, %t, %s);\n",
			quote(project.ID), quote(project.Name), quote(project.Slug), quote(project.APIKey), quote(project.TeamID),
			sqlTime(project.CreatedAt), sqlTime(project.CreatedAt), archived, project.Personal, owner)
	}
}

func quote(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }

func sqlTime(at time.Time) string { return quote(at.UTC().Format(time.RFC3339)) }
