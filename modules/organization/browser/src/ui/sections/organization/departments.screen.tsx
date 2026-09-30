/**
 * The Directory's Departments tab: every department, read-only. They are managed on
 * Governance's People page, so the one action sends the reader there.
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { Building2 } from "lucide-react";

import { api } from "../../../behavior/organization-api.ts";
import {
  useDepartmentColumn,
  type DepartmentOption,
} from "../../../behavior/use-department-column.ts";
import { useOrganizationHost } from "../../../model/organization-host.ts";
import { IdentityRowList } from "../../elements/identity-row.tsx";
import { SectionTitle } from "../../elements/section-title.tsx";

export default function DepartmentsScreen({ organizationId }: { organizationId: string }) {
  const host = useOrganizationHost();
  const department = useDepartmentColumn(
    organizationId,
    host.isFeatureEnabled("release_ui_ai_governance_enabled"),
  );
  // The People tab's own read, so one request serves both.
  const members = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: true },
    { enabled: !!organizationId },
  );

  const unassignedCount = members.data?.members.filter(
    (member) => !department.byUser.get(member.userId),
  ).length;

  return (
    <VStack align="stretch" gap={6} width="full">
      <SectionTitle
        title="Departments"
        hint="Who sits where in the organization, for accounting and reporting. Assignment is never an access gate. A department grants nothing."
        right={
          <Link href="/governance/people">
            <Button size="sm" variant="outline">
              Manage in Governance
            </Button>
          </Link>
        }
      />

      <IdentityRowList data-testid="departments-list" empty="No department has been created yet.">
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

      {unassignedCount !== undefined && unassignedCount > 0 && (
        <Text fontSize="xs" lineHeight="1.6" color="fg.muted">
          {unassignedCount === 1 ? "1 person unassigned" : `${unassignedCount} people unassigned`}
        </Text>
      )}
    </VStack>
  );
}

function assigned(map: ReadonlyMap<string, string | null>, departmentId: string): number {
  return [...map.values()].filter((value) => value === departmentId).length;
}

/** Not the full IdentityRow: a department has no avatar and no address. */
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

function countLabel({
  count,
  one,
  many,
}: {
  count: number;
  one: string;
  many: string;
}): string | null {
  if (count === 0) return null;
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** A zero segment is left out; a department holding nothing says so plainly. */
function assignmentLabel({
  people,
  teams,
  projects,
}: {
  people: number;
  teams: number;
  projects: number;
}): string {
  const segments = [
    countLabel({ count: people, one: "person", many: "people" }),
    countLabel({ count: teams, one: "team", many: "teams" }),
    countLabel({ count: projects, one: "project", many: "projects" }),
  ].filter((segment) => segment !== null);
  return segments.length > 0 ? segments.join(" · ") : "Nobody assigned yet";
}
