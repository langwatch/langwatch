import { FoundryDrawer as FoundryDrawerSurface } from "@langwatch/ops-web";
import { useDrawer } from "~/hooks/useDrawer";
import { FoundryTransport } from "./foundry-transport";

export function FoundryDrawer() {
  const { closeDrawer } = useDrawer();

  return (
    <FoundryTransport>
      <FoundryDrawerSurface onClose={closeDrawer} />
    </FoundryTransport>
  );
}
