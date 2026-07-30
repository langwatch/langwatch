import { DejaViewContent } from "~/components/ops/dejaview";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";

export default function OpsDejaViewPage() {
  return (
    <OpsPageShell>
      <DejaViewContent />
    </OpsPageShell>
  );
}
