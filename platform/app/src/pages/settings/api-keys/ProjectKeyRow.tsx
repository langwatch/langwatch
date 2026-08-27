import { Button, Table, Text } from "@chakra-ui/react";
import { Key, RotateCw } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";
import {
  ApiKeyAccessBadge,
  ApiKeyNameCell,
  ApiKeyOwnerCell,
  ApiKeyScopeCell,
} from "./ApiKeyTableCells";

/**
 * The project's own key, rendered as one more row of the credentials table.
 *
 * It predates the key model, so it carries none of the model's history: nobody
 * is recorded as having created it and nothing records when it was last used.
 * Those two cells say "Not recorded" rather than a dash, because a dash reads
 * as data that failed to load rather than a fact about this row.
 *
 * Its one lifecycle action is rotation, so the action stays a labelled button
 * rather than an overflow menu holding a single item. Copying lives beside the
 * value in the key cell, where the other rows put it — and unlike them, this
 * row copies the real key, which is why its label and confirmation say key
 * where theirs say identifier.
 */
export function ProjectKeyRow({
  apiKey,
  projectId,
  projectName,
  canManage,
  onRotate,
}: {
  apiKey: string;
  projectId: string;
  projectName?: string;
  canManage: boolean;
  onRotate: () => void;
}) {
  return (
    <Table.Row>
      <Table.Cell>
        <ApiKeyNameCell
          name="Project API Key"
          description={null}
          secret={{
            display: `sk-…${apiKey.slice(-4)}`,
            copyValue: apiKey,
            copyLabel: "Copy the project API key",
            copiedTitle: "API key copied to clipboard",
          }}
          isExpired={false}
          icon={<Key size={14} aria-hidden />}
        />
      </Table.Cell>
      <Table.Cell>
        <ApiKeyScopeCell
          scopes={[
            { scopeType: "PROJECT", scopeId: projectId, name: projectName },
          ]}
        />
      </Table.Cell>
      <Table.Cell>
        <ApiKeyAccessBadge permissionMode="all" />
      </Table.Cell>
      <Table.Cell>
        <ApiKeyOwnerCell ownerName={null} ownerEmail={null} />
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          Not recorded
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          Not recorded
        </Text>
      </Table.Cell>
      <Table.Cell>
        {canManage && (
          <Tooltip content="Rotate this key">
            <Button
              size="xs"
              variant="ghost"
              aria-label="Rotate Project API Key"
              onClick={onRotate}
            >
              <RotateCw size={14} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
