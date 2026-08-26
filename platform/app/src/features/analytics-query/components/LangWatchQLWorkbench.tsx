/** Application composition for the portable LangWatchQL workbench. */
import { useMemo } from "react";

import { LangWatchQLWorkbench as PackageWorkbench } from "@langwatch/analytics-web";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { HandledErrorAlert } from "~/features/errors";

import { useLangWatchQLQuery } from "../hooks/useLangWatchQLQuery";
import { useLangWatchQLSchema } from "../hooks/useLangWatchQLSchema";
import { useSavedChartWiring } from "../hooks/useSavedChartWiring";
import { LazyLangWatchQLChartMode } from "./LazyLangWatchQLChartMode";
import { SavedChartsToolbar } from "./SavedChartsToolbar";

export interface LangWatchQLWorkbenchProps {
  readonly projectId: string;
}

export function LangWatchQLWorkbench({ projectId }: LangWatchQLWorkbenchProps) {
  const schema = useLangWatchQLSchema({ projectId });
  const query = useLangWatchQLQuery({ projectId });
  const wiring = useSavedChartWiring({ projectId, query });
  const { period } = usePeriodSelector();
  const { colorMode } = useColorMode();
  const pageTimeWindow = useMemo(
    () => ({ start: period.startDate.getTime(), end: period.endDate.getTime() }),
    [period.startDate, period.endDate],
  );

  return (
    <PackageWorkbench
      schema={schema}
      query={query}
      pageTimeWindow={pageTimeWindow}
      editorTheme={colorMode === "dark" ? "vs-dark" : "vs"}
      openedRevision={wiring.openedRevision}
      openedSpecText={wiring.openedSpecText}
      initialParameters={wiring.openedParameters}
      renderError={(error, fallbackTitle) => (
        <HandledErrorAlert error={error} fallbackTitle={fallbackTitle} />
      )}
      renderToolbar={({ canSave, draft }) => (
        <SavedChartsToolbar
          charts={wiring.saved.charts}
          openedChartId={wiring.saved.openedChartId}
          openedChartName={wiring.saved.openedChartName}
          isSaving={wiring.saved.isSaving}
          canSave={canSave}
          onSave={({ name }) =>
            void wiring.saved.save({ draft, ...(name === undefined ? {} : { name }) })
          }
          onOpen={(chartId) => void wiring.saved.open(chartId)}
          onRename={(input) => void wiring.saved.rename(input)}
          onDelete={(chartId) => void wiring.saved.remove(chartId)}
          onSaveAsNew={wiring.saved.closeOpened}
        />
      )}
      renderChart={({
        view,
        openSpecification,
        result,
        submittedLabel,
        editedSpecText,
        onEditedSpecTextChange,
      }) => (
        <LazyLangWatchQLChartMode
          key={`chart-${wiring.openedRevision}`}
          result={result}
          submittedLabel={submittedLabel}
          view={view === "specification" ? "specification" : "chart"}
          onOpenSpecification={openSpecification}
          editedSpecText={editedSpecText}
          onEditedSpecTextChange={onEditedSpecTextChange}
        />
      )}
    />
  );
}
