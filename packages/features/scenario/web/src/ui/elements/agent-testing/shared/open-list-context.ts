/**
 * How a field tells the dialog around it that its list is open.
 */

import { createContext, useContext, useEffect, useId } from "react";

export type ReportOpenList = (list: { id: string; isOpen: boolean }) => void;

export const OpenListContext = createContext<ReportOpenList | null>(null);

/** Reports whether this field's list is open to the dialog, when one listens. */
export function useReportOpenList(isOpen: boolean): void {
  const report = useContext(OpenListContext);
  const id = useId();
  useEffect(() => {
    if (!report) return;
    report({ id, isOpen });
    return () => report({ id, isOpen: false });
  }, [report, id, isOpen]);
}
