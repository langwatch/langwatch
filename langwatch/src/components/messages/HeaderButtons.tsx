import { Box, Button, HStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { List, Table } from "react-feather";
import { LuTrendingUp } from "react-icons/lu";
import { useLocalStorage } from "usehooks-ts";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { PageLayout } from "../ui/layouts/PageLayout";

export function useTableView() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const [localStorageTableView, setLocalStorageTableView] = useLocalStorage<
    "table" | "list"
  >("tableView", "table");
  const isTableView = (router.query.view ?? localStorageTableView) === "table";

  const setView = (view: "table" | "list") => () => {
    void router.push(
      {
        query: {
          ...router.query,
          view,
        },
      },
      undefined,
      { shallow: true },
    );
    setLocalStorageTableView(view);
  };

  useEffect(() => {
    if (!project || !router.pathname.includes("/messages")) return;

    if (router.query.view === undefined) {
      void router.replace({
        query: {
          ...router.query,
          project: project.slug,
          view: localStorageTableView ?? "table",
        },
      });
    } else {
      setLocalStorageTableView(isTableView ? "table" : "list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  return { isTableView, setView };
}

export function ToggleTableView() {
  const { isTableView, setView } = useTableView();

  const [isHovered, setIsHovered] = useState(false);

  const sliderOnLeft = {
    left: "3px",
    width: "108px",
  };
  const sliderOnRight = {
    left: "113px",
    width: "112px",
  };

  const sliderProps =
    (isTableView && !isHovered) || (!isTableView && isHovered)
      ? sliderOnRight
      : sliderOnLeft;

  return (
    <HStack
      background="bg.emphasized"
      padding="3px"
      paddingY={0}
      borderRadius="lg"
      gap={2}
      position="relative"
    >
      <Box
        background="bg.panel"
        position="absolute"
        height="26px"
        borderRadius="6px"
        transition="all 0.3s ease-out"
        {...sliderProps}
      ></Box>
      <Button
        height="32px"
        variant="ghost"
        _hover={{ background: "none" }}
        {...(isTableView
          ? {
              onMouseEnter: () => setIsHovered(true),
              onMouseLeave: () => setIsHovered(false),
              onClick: setView("list"),
            }
          : {})}
      >
        <List size="14" /> List View
      </Button>
      <Button
        height="32px"
        variant="ghost"
        _hover={{ background: "none" }}
        {...(!isTableView
          ? {
              onMouseEnter: () => setIsHovered(true),
              onMouseLeave: () => setIsHovered(false),
              onClick: setView("table"),
            }
          : {})}
      >
        <Table size="14" /> Table View
      </Button>
    </HStack>
  );
}

export function ToggleAnalytics() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  return (
    <Tooltip content="Show analytics for those messages">
      <PageLayout.HeaderButton
        variant="ghost"
        onClick={() => {
          const { project: _project, view: _view, ...query } = router.query;
          void router.push({
            pathname: `/${project?.slug}/analytics`,
            query,
          });
        }}
      >
        <LuTrendingUp />
        Show Graphs
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
