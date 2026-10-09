import { type ProjectNavigation, projectNavigation } from "@langwatch/project-contract";
import { useMemo } from "react";

import { useNavigationHost } from "../../../model/navigation-host.ts";

/** What the current project's navigation shows; an organization page holds no project and keeps all. */
export function useCommandProjectNavigation(): ProjectNavigation {
  const kind = useNavigationHost().project()?.kind;
  return useMemo(() => projectNavigation(kind), [kind]);
}
