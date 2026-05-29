import { SectionRow } from "./SectionRow";

/**
 * Placeholder cadence row. Notify automations will eventually let the
 * author choose immediate vs digest windows (ADR-025). Until that ships,
 * the section is rendered but disabled so users know it's coming and
 * existing automations stay on immediate dispatch.
 */
export function CadenceSection() {
  return (
    <SectionRow
      title="Cadence"
      summary="Coming soon: batch notifications into digests (ADR-025)"
      complete={false}
      disabled
      onClick={() => {}}
    />
  );
}
