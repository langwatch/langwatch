import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { DejaViewContent } from "~/components/ops/dejaview";

export default function OpsDejaViewPage() {
  return (
    <OpsPageShell>
      <DejaViewContent />
    </OpsPageShell>
  );
}
