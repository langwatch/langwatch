import { Kbd } from "@langwatch/ops-web/surfaces/keyboard-key";
import { useTraceList } from "../hooks/use-trace-list";
import { TraceFindBar } from "../../trace-find-bar";

export function FindBar() {
  const { data: traces } = useTraceList();

  return <TraceFindBar traces={traces} renderShortcutKey={(label) => <Kbd>{label}</Kbd>} />;
}
