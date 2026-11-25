import {
  DeployLabelSelect,
  type DeployLabelSelectProps,
} from "@langwatch/design-system/deploy-label-select";
import { Field, Text } from "@langwatch/design-system/primitives";

/** The experiment target's deploy label: which version of the agent the experiment runs. */
export function TargetAgentLabelField({
  target,
}: {
  target: Pick<DeployLabelSelectProps, "labels" | "latestVersion" | "onChange"> & {
    label: string | undefined;
  };
}) {
  return (
    <Field.Root>
      <Field.Label>Deploy label</Field.Label>
      <DeployLabelSelect
        value={target.label}
        onChange={target.onChange}
        labels={target.labels}
        latestVersion={target.latestVersion}
        aria-label="Deploy label"
        data-testid="target-agent-label-select"
      />
      <Text fontSize="xs" color="fg.muted" marginTop={1}>
        The experiment runs the agent version this label points at.
      </Text>
    </Field.Root>
  );
}
