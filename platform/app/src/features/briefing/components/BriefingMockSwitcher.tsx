import { chakra } from "@chakra-ui/react";
import type { ChangeEvent } from "react";
import {
  BRIEFING_MOCKS,
  isBriefingMockAvailable,
  setBriefingMock,
  useBriefingMock,
} from "../mocks/briefingMocks";

/**
 * Development-only preview control for the Langy briefing's DATA states.
 *
 * There are 30-plus generated permutations (see briefingMocks), so this is a
 * dropdown rather than an icon rail — "Live data" hands the briefing back to the
 * project's real data, any other option pins it to a mock and snaps the page to
 * the briefing view so the change is visible. Never rendered in production
 * (spec: specs/home/langy-briefing.feature).
 */
export function BriefingMockSwitcher() {
  const active = useBriefingMock();
  if (!isBriefingMockAvailable()) return null;

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setBriefingMock(event.target.value || null);
  };

  return (
    <chakra.select
      value={active ?? ""}
      onChange={onChange}
      aria-label="Preview briefing data (dev only)"
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
      <option value="">Live data</option>
      {BRIEFING_MOCKS.map((mock) => (
        <option key={mock.key} value={mock.key}>
          {mock.label}
        </option>
      ))}
    </chakra.select>
  );
}
