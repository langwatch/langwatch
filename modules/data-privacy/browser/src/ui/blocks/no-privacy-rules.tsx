import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus, Shield } from "lucide-react";

/** What the page shows before any rule exists: the defaults, and the way to change them. */
export function NoPrivacyRules({ canWrite, onAdd }: { canWrite: boolean; onAdd: () => void }) {
  return (
    <NoDataInfoBlock
      title="No privacy rules"
      description="Secrets redaction and essential PII redaction are on by default, and content is captured and visible to your team. Add a rule to change that at any scope."
      icon={<Shield size={24} />}
    >
      {canWrite && (
        <PageLayout.HeaderButton primary onClick={onAdd}>
          <Plus /> Add privacy rule
        </PageLayout.HeaderButton>
      )}
    </NoDataInfoBlock>
  );
}
