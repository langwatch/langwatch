import { HandledErrorAlert } from "~/features/errors";
import { LangWatchQLSchemaBrowser as PackageSchemaBrowser } from "@langwatch/analytics-web";
import type { LangWatchQLSchemaBrowserProps } from "@langwatch/analytics-web";

export type { LangWatchQLSchemaBrowserProps } from "@langwatch/analytics-web";

export function LangWatchQLSchemaBrowser(props: LangWatchQLSchemaBrowserProps) {
  return (
    <PackageSchemaBrowser
      {...props}
      renderError={(error) => (
        <HandledErrorAlert error={error} fallbackTitle="Couldn't load the schema" />
      )}
    />
  );
}
