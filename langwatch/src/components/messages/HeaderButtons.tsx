import { useRouter } from "next/router";
import { useEffect } from "react";
import { List, Table } from "react-feather";
import { LuTrendingUp } from "react-icons/lu";
import { useLocalStorage } from "usehooks-ts";
import { ButtonToggleSlider } from "../../components/ui/ButtonToggleSlider";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { PageLayout } from "../ui/layouts/PageLayout";

export function useTableView() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const [localStorageTableView, setLocalStorageTableView] =
    useLocalStorage<string>("tableView", "table");
  const isTableView = (router.query.view ?? localStorageTableView) === "table";

  const setView = (view: string) => () => {
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
          view: localStorageTableView ?? "table",
        },
      });
    } else {
      setLocalStorageTableView(isTableView ? "table" : "list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  return { isTableView, setView, value: localStorageTableView };
}

export function ToggleTableView() {
  const { setView, value } = useTableView();

  return (
    <ButtonToggleSlider.Root
      value={value}
      onChange={(value) => setView(value)()}
    >
      <ButtonToggleSlider.Button value="list">
        <List size="14" />
        List View
      </ButtonToggleSlider.Button>
      <ButtonToggleSlider.Button value="table">
        <Table size="14" />
        Table View
      </ButtonToggleSlider.Button>
    </ButtonToggleSlider.Root>
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
        <LuTrendingUp />
        Show Graphs
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
