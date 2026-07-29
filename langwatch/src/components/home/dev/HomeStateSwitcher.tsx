import { chakra } from "@chakra-ui/react";
import type { ChangeEvent } from "react";
import {
  HOME_DEV_STATES,
  type HomeDevState,
  isHomeDevStateAvailable,
  setHomeDevState,
  useHomeDevState,
} from "./homeDevState";

/**
 * Development-only preview control for the Langy home's STATES.
 *
 * Sits beside the briefing's data switcher in the footer, and works the same
 * way: "Live" hands the page back to the project's real data and the reader's
 * real settings, any other option pins one state. Never rendered in production
 * (spec: specs/home/langy-home.feature).
 */
export function HomeStateSwitcher() {
  const active = useHomeDevState();
  if (!isHomeDevStateAvailable()) return null;

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setHomeDevState((event.target.value || null) as HomeDevState | null);
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
