import { chakra } from "@chakra-ui/react";
import { useUiDeployment } from "@langwatch/ui-host/capabilities";
import type { ChangeEvent } from "react";
import { BRIEFING_MOCKS, setBriefingMock, useBriefingMock } from "../mocks/briefing-mocks";

/**
 * Development-only preview control for the Langy briefing's DATA states, a
 * dropdown over 30-plus generated permutations. Never rendered in production.
 * Spec: specs/home/langy-briefing.feature
 */
export function BriefingMockSwitcher() {
  const active = useBriefingMock();
  const { isDevelopment } = useUiDeployment();
  if (!isDevelopment) return null;

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
