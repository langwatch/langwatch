import { Button, HStack, Heading, Spacer, Tooltip } from "@chakra-ui/react";
import { MessageSquare } from "react-feather";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { FilterToggle } from "../filters/FilterToggle";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export function AnalyticsHeader({ title }: { title: string }) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  return (
    <HStack width="full" align="top" paddingBottom={6}>
      <HStack align="center" spacing={6}>
        <Heading as={"h1"} size="lg" paddingTop={1}>
          {title}
        </Heading>
        <Tooltip label="Show messages behind those metrics">
          <Button
            variant="outline"
            minWidth={0}
            height="32px"
            padding={2}
            marginTop={2}
            onClick={() => {
              void router.push(
                {
                  pathname: `/${project?.slug}/messages`,
                  query: {
                    ...router.query,
                  },
                },
                undefined,
                { shallow: true }
              );
            }}
          >
            <MessageSquare size="16" />
          </Button>
        </Tooltip>
      </HStack>
      <Spacer />
      <FilterToggle />
      <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
    </HStack>
  );
}
