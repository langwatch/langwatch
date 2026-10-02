import type { ReactNode } from "react";

export type SimSplitProps = {
  list: ReactNode;
  /** `null` or absent shows `emptyDetail`. */
  detail?: ReactNode;
  emptyDetail?: ReactNode;
};

/** A list pane beside the open item's detail; stacked on a narrow screen. */
export const SimSplit = ({ list, detail, emptyDetail }: SimSplitProps) => (
  <div className="sim-split">
    <div className="sim-split-list">{list}</div>
    <div className="sim-split-detail">{detail ?? emptyDetail}</div>
  </div>
);
