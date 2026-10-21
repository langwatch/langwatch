/** Workflow's version badge, as workflow lends it (§3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import { Box } from "@langwatch/design-system/primitives";
import { VersionBoxToken, type VersionBoxProps } from "@langwatch/workflow-client";

/** The lent badge; an empty box of the same width until it loads. */
export function VersionBox(props: VersionBoxProps) {
  return (
    <Lent
      of={VersionBoxToken}
      props={props}
      fallback={<Box minWidth={props.minWidth} height="44px" />}
    />
  );
}
