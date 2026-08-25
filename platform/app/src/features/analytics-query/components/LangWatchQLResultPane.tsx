import { HandledErrorAlert } from "~/features/errors";
import { LangWatchQLResultPane as PackageResultPane } from "@langwatch/analytics-web";
import type { LangWatchQLResultPaneProps } from "@langwatch/analytics-web";

export type {
  LangWatchQLResultView,
  LangWatchQLResultPaneProps,
} from "@langwatch/analytics-web";

export function LangWatchQLResultPane(props: LangWatchQLResultPaneProps) {
  return (
    <PackageResultPane
      {...props}
      renderError={(error, fallbackTitle) => (
        <HandledErrorAlert error={error} fallbackTitle={fallbackTitle} />
      )}
    />
  );
}
