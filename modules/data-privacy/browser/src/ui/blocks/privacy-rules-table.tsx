import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Button, Card, Table, Text } from "@langwatch/design-system/primitives";
import { MoreVertical } from "lucide-react";

import { ruleSummary } from "../../model/data-privacy-rule-config.ts";
import { RuleScopeLabel } from "../elements/rule-scope-label.tsx";

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
    <Card.Root width="full" overflow="hidden">
      <Card.Body paddingX={0} paddingY={0}>
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Scope</Table.ColumnHeader>
              <Table.ColumnHeader>Rule</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rules.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text color="fg.muted" fontSize="sm" paddingY={2}>
                    No privacy rules at the selected scope.
                  </Text>
                </Table.Cell>
              </Table.Row>
            ) : (
              rules.map((rule) => (
                <Table.Row key={`${rule.scopeType}:${rule.scopeId}:${rule.personalOnly}`}>
                  <Table.Cell>
                    <RuleScopeLabel rule={rule} />
                  </Table.Cell>
                  <Table.Cell>{ruleSummary(rule.config)}</Table.Cell>
                  <Table.Cell textAlign="end">
                    {canWrite && <RuleActions rule={rule} onEdit={onEdit} onRemove={onRemove} />}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
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
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={() => onEdit(rule)}>
          Edit
        </Menu.Item>
        <Menu.Item value="delete" color="red.500" onClick={() => onRemove(rule)}>
          Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
