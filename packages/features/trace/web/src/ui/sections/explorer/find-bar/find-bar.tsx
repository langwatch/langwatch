import { Kbd } from "@langwatch/ops-web/surfaces/keyboard-key";
import { useTraceList } from "../hooks/use-trace-list.ts";
import { TraceFindBar } from "../../trace-find-bar.tsx";

export function FindBar() {
  const { data: traces } = useTraceList();

  return <TraceFindBar traces={traces} renderShortcutKey={(label) => <Kbd>{label}</Kbd>} />;
}
