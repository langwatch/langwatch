import { Box, Button, HStack, Tooltip } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { List, Table, TrendingUp } from "react-feather";
import { useEffect, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

export function useTableView() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const [localStorageTableView, setLocalStorageTableView] = useLocalStorage<
    "table" | "list"
  >("tableView", "list");
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
      { shallow: true }
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
          view: localStorageTableView ?? "list",
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
    width: "125px",
  };
  const sliderOnRight = {
    left: "128px",
    width: "139px",
  };

  const sliderProps =
    (isTableView && !isHovered) || (!isTableView && isHovered)
      ? sliderOnRight
      : sliderOnLeft;

  return (
    <HStack
      background="gray.200"
      padding="3px"
      borderRadius="6px"
      border="1px solid"
      borderColor="gray.350"
      spacing={0}
      position="relative"
    >
      <Box
        background="gray.100"
        position="absolute"
        height="32px"
        borderRadius="6px"
        transition="all 0.3s ease-out"
        {...sliderProps}
      ></Box>
      <Button
        leftIcon={<List size="14" />}
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
        List View
      </Button>
      <Button
        leftIcon={<Table size="14" />}
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
        Table View
      </Button>
    </HStack>
  );
}

export function ToggleAnalytics() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  return (
    <Tooltip label="Show analytics for those messages">
      <Button
        variant="outline"
        minWidth={0}
        height="32px"
        padding={2}
        marginTop={2}
        onClick={() => {
          void router.push(
            {
              pathname: `/${project?.slug}`,
              query: {
                ...router.query,
              },
            },
            undefined,
            { shallow: true }
          );
        }}
      >
        <TrendingUp size="16" />
      </Button>
    </Tooltip>
  );
}
