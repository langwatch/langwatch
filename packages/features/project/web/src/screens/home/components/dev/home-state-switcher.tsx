import { chakra } from "@chakra-ui/react";
import { useUiDeployment } from "@langwatch/ui-host/capabilities";
import type { ChangeEvent } from "react";
import {
  HOME_DEV_STATES,
  type HomeDevState,
  setHomeDevState,
  useHomeDevState,
} from "./home-dev-state";

/**
 * Development-only preview control for the Langy home's STATES. Sits beside
 * the briefing's data switcher; never rendered in production.
 * Spec: specs/home/langy-home.feature
 */
export function HomeStateSwitcher() {
  const active = useHomeDevState();
  const { isDevelopment } = useUiDeployment();
  if (!isDevelopment) return null;

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setHomeDevState({
      state: (event.target.value || null) as HomeDevState | null,
      isDevelopment,
    });
  };

  return (
    <chakra.select
      value={active ?? ""}
      onChange={onChange}
      aria-label="Preview home state (dev only)"
      fontFamily="mono"
      fontSize="11px"
      color="fg.muted"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      background="bg.panel/60"
      backdropFilter="blur(8px)"
      paddingX={2}
      paddingY={1.5}
      maxWidth="220px"
      cursor="pointer"
      _hover={{ color: "fg", borderColor: "border.emphasized" }}
    >
      <option value="">Live home</option>
      {HOME_DEV_STATES.map((state) => (
        <option key={state.key} value={state.key}>
          {state.label}
        </option>
      ))}
    </chakra.select>
  );
}
