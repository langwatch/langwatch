import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiLicenseBillingSectionProps } from "@langwatch/browser-host/declarations";
import { type ComponentType, lazy, useMemo } from "react";

/** The Billing sections installed modules declared for a linked license, in install order. */
export function useLicenseBillingSections(): readonly {
  key: string;
  Section: ComponentType<UiLicenseBillingSectionProps>;
}[] {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so a section is not remounted.
  return useMemo(
    () =>
      declarations
        .declared("licenseBillingSection")
        .map(({ module, capability }) => ({ key: module, Section: lazy(capability.load) })),
    [declarations],
  );
}
