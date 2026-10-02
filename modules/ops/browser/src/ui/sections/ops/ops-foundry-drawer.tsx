import {
  FoundryDrawer,
  type UiFoundryDrawerProps,
} from "../../../features/foundry/ui/sections/foundry-drawer.tsx";
import { FoundryTransport } from "../../../features/foundry/ui/sections/foundry-transport.tsx";

/** The routed `foundry` drawer: the palette opens it off the page, so it brings its own runtime. */
export default function OpsFoundryDrawer(props: UiFoundryDrawerProps) {
  return (
    <FoundryTransport includeProjects>
      <FoundryDrawer {...props} />
    </FoundryTransport>
  );
}
