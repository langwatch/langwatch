import type { ComponentProps } from "react";
import {
  LangyChoicesCard as LangyChoicesCardPresentation,
  type ChoicesRefRow,
} from "@langwatch/langy-web";
import { useChoicesRefRows } from "./useChoicesRefRows";

type PresentationProps = ComponentProps<typeof LangyChoicesCardPresentation>;

export type LangyChoicesCardProps = Omit<PresentationProps, "refRows"> & {
  refRowsOverride?: ReadonlyMap<string, ChoicesRefRow>;
};

/** App adapter for viewer-scoped reference hydration. */
export function LangyChoicesCard({ refRowsOverride, ...props }: LangyChoicesCardProps) {
  const hydratedRows = useChoicesRefRows(refRowsOverride ? [] : props.card.options);
  const refRows = refRowsOverride ?? hydratedRows;

  return <LangyChoicesCardPresentation {...props} refRows={refRows} />;
}
