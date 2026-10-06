/** Workflow's version badge and "Run via API" dialog, as workflow lends them (§3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import { Box } from "@langwatch/design-system/primitives";
import {
  RunExperimentViaApiDialogToken,
  VersionBoxToken,
  type RunExperimentViaApiDialogProps,
  type VersionBoxProps,
} from "@langwatch/workflow-contract";

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

/** The lent dialog; nothing when workflow is not installed. */
export function RunExperimentViaApiDialog(props: RunExperimentViaApiDialogProps) {
  return <Lent of={RunExperimentViaApiDialogToken} props={props} />;
}
