import { Kbd } from "@langwatch/ops-web";
import { useTraceList } from "../hooks/use-trace-list";
import { TraceFindBar } from "../../../../index";

export function FindBar() {
  const { data: traces } = useTraceList();

  return (
    <TraceFindBar traces={traces} renderShortcutKey={(label) => <Kbd>{label}</Kbd>} />
  );
}
