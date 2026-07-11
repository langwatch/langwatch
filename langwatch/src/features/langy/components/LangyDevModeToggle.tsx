/**
 * Header toggle for Langy's developer mode.
 *
 * Off by default. When on, every tool call in a turn can be expanded to its raw
 * payload (see {@link LangyToolActivity}) so the event stream behind the
 * rendered cards is inspectable. State is per-browser (localStorage), not a
 * server setting.
 */
import { IconButton } from "@chakra-ui/react";
import { Braces } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { useLangyDevMode } from "../hooks/useLangyDevMode";

export function LangyDevModeToggle() {
  const [devMode, setDevMode] = useLangyDevMode();
  return (
    <Tooltip
      content={
        devMode
          ? "Developer mode on — showing raw tool data"
          : "Developer mode — inspect raw tool data"
      }
      showArrow
    >
      <IconButton
        size="xs"
        variant="ghost"
        aria-label="Toggle developer mode"
        aria-pressed={devMode}
        color={devMode ? "orange.solid" : "fg.muted"}
        onClick={() => setDevMode(!devMode)}
      >
        <Braces size={15} />
      </IconButton>
    </Tooltip>
  );
}
