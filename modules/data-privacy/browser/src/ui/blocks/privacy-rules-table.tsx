import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Button } from "@langwatch/design-system/primitives";

import { ruleSummary } from "../../model/data-privacy-rule-config.ts";
import { RuleScopeLabel } from "../elements/rule-scope-label.tsx";

const PRIVACY_DOCS_HREF = "https://langwatch.ai/docs/platform/data-privacy";

/** The rules at the selected scope, each with edit and delete for a caller who may write. */
export function PrivacyRulesTable({
  rules,
  canWrite,
  onEdit,
  onRemove,
}: {
  rules: DataPrivacyRule[];
  canWrite: boolean;
  onEdit: (rule: DataPrivacyRule) => void;
  onRemove: (rule: DataPrivacyRule) => void;
}) {
  return (
    <ListTable aria-label="Privacy rules">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Scope</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Rule</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rules.length === 0 ? (
          <ListTable.EmptyRow
            columns={3}
            state="no-results"
            title="No privacy rules at the selected scope"
            next={[{ kind: "docs", label: "How privacy rules cascade", href: PRIVACY_DOCS_HREF }]}
          />
        ) : (
          rules.map((rule) => (
            <ListTable.Row key={`${rule.scopeType}:${rule.scopeId}:${rule.personalOnly}`}>
              <ListTable.Cell>
                <RuleScopeLabel rule={rule} />
              </ListTable.Cell>
              <ListTable.Cell>{ruleSummary(rule.config)}</ListTable.Cell>
              <ListTable.ActionCell>
                {canWrite && <RuleActions rule={rule} onEdit={onEdit} onRemove={onRemove} />}
              </ListTable.ActionCell>
            </ListTable.Row>
          ))
        )}
      </ListTable.Body>
    </ListTable>
  );
}

function RuleActions({
  rule,
  onEdit,
  onRemove,
}: {
  rule: DataPrivacyRule;
  onEdit: (rule: DataPrivacyRule) => void;
  onRemove: (rule: DataPrivacyRule) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${rule.name} privacy rule`}>
          <MoreVerticalIcon size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={() => onEdit(rule)}>
          Edit
        </Menu.Item>
        <Menu.Item value="delete" color="red.fg" onClick={() => onRemove(rule)}>
          Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
