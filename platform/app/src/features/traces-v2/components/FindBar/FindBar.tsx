import { Kbd } from "~/components/ops/shared/Kbd";
import { useTraceList } from "../../hooks/useTraceList";
import { TraceFindBar } from "@langwatch/trace-web";

export function FindBar() {
  const { data: traces } = useTraceList();

  return (
    <TraceFindBar traces={traces} renderShortcutKey={(label) => <Kbd>{label}</Kbd>} />
  );
}
