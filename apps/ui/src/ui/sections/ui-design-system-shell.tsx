import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from "@langwatch/design-system/provider";

export type UiDesignSystemShellProps = DesignSystemProviderProps;

export function UiDesignSystemShell(props: UiDesignSystemShellProps) {
  return <DesignSystemProvider {...props} />;
}
