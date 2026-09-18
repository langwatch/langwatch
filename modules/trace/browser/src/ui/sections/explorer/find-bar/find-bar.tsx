import { Kbd } from "@langwatch/design-system/kbd";

import { TraceFindBar } from "../../trace-find-bar.tsx";
import { useTraceList } from "../hooks/use-trace-list.ts";

export function FindBar() {
  const { data: traces } = useTraceList();

  return <TraceFindBar traces={traces} renderShortcutKey={(label) => <Kbd>{label}</Kbd>} />;
}
