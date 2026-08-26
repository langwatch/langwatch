import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Building2 } from "lucide-react";
import { IdentityRowList } from "~/components/access/IdentityRow";
import { SectionTitle } from "~/components/settings/kit/SettingRow";
import {
  type DepartmentOption,
  useDepartmentColumn,
} from "~/components/settings/useDepartmentColumn";
import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

/**
 * Every department in the organization, read-only (D05).
 *
 * Departments are the AI-governance org structure — who sits where, for
 * accounting and reporting — and they are MANAGED on Governance's People
 * page. This tab only references them: the list, and how many people, teams
 * and projects each one holds. The single action sends the reader to where
 * assignment actually happens, because a create box here would be a second,
 * competing place to do one thing.
 *
 * READS DEGRADE, THEY DO NOT REFUSE. The departments queries gate on
 * `governance:view`, which a holder of `organization:manage` need not have —
 * for them the hook reports nothing to show, and the tab above never opens
 * this section at all. No error, no empty frame.
 *
 * Spec: specs/ai-gateway/governance/departments.feature
 */
export function DepartmentsSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const department = useDepartmentColumn(organizationId);

  // The same members read the People tab runs, so react-query serves both
  // from one request — the footnote must never cost a query of its own.
  const members =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: true },
      { enabled: !!organizationId },
    );

  const assigned = (map: Map<string, string>, departmentId: string) => {
    let count = 0;
    for (const value of map.values()) if (value === departmentId) count += 1;
    return count;
  };

  const unassignedCount = members.data
    ? members.data.members.filter(
        (member) => !department.byUser.get(member.userId),
      ).length
    : undefined;

  return (
    <VStack align="stretch" gap={6} width="full">
      <SectionTitle
        title="Departments"
        hint="Who sits where in the organization, for accounting and reporting. Assignment is never an access gate — a department grants nothing."
        right={
          <Link href="/governance/people">
            <Button size="sm" variant="outline">
              Manage in Governance
            </Button>
          </Link>
        }
      />

      <IdentityRowList
        data-testid="departments-list"
        empty="No department has been created yet."
      >
        {department.departments.map((option) => (
          <DepartmentRow
            key={option.id}
            department={option}
            people={assigned(department.byUser, option.id)}
            teams={assigned(department.byTeam, option.id)}
            projects={assigned(department.byProject, option.id)}
          />
        ))}
      </IdentityRowList>

      {/* A zero needs no saying: everybody assigned is the steady state, and
          a footnote that usually reads "0 people unassigned" is noise at the
          bottom of every visit. It speaks only when somebody is missing. */}
      {unassignedCount !== undefined && unassignedCount > 0 && (
        <Text fontSize="11.5px" lineHeight="1.6" color="fg.muted">
          {unassignedCount === 1
            ? "1 person unassigned"
            : `${unassignedCount} people unassigned`}
        </Text>
      )}
    </VStack>
  );
}

/**
 * One department: an icon, a name, and how much it holds. Not the full
 * `IdentityRow` — a department has no avatar and no address, and borrowing
 * the person's shape would draw it as a person it is not. The row still
 * sits in the same list, with the same padding, so the two read as one page.
 */
function DepartmentRow({
  department,
  people,
  teams,
  projects,
}: {
  department: DepartmentOption;
  people: number;
  teams: number;
  projects: number;
}) {
  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      align="center"
      data-testid="department-row"
    >
      <Box color="fg.muted" flexShrink={0} display="flex">
        <Building2 size={14} />
      </Box>
      <Text fontSize="sm" fontWeight="medium" flex={1} minWidth={0} truncate>
        {department.name}
      </Text>
      <Text fontSize="xs" color="fg.muted" flexShrink={0}>
        {assignmentLabel({ people, teams, projects })}
      </Text>
    </HStack>
  );
}

/**
 * What a department holds, in its own words. A zero segment is left out
 * rather than read out — "3 people · 0 teams · 0 projects" is one fact
 * wearing three — and a department holding nothing says so plainly.
 */
function assignmentLabel({
  people,
  teams,
  projects,
}: {
  people: number;
  teams: number;
  projects: number;
}): string {
  const segments: string[] = [];
  if (people > 0) segments.push(people === 1 ? "1 person" : `${people} people`);
  if (teams > 0) segments.push(teams === 1 ? "1 team" : `${teams} teams`);
  if (projects > 0)
    segments.push(projects === 1 ? "1 project" : `${projects} projects`);
  return segments.length > 0 ? segments.join(" · ") : "Nobody assigned yet";
}
