// Every live braid in the organisation: from which project into which, the condition and the dates.
// Spec: modules/authz/specs/braids-screen.feature, "An organisation admin chooses who may braid".

import { Link } from "@langwatch/browser-host/link";
import { ListTable } from "@langwatch/design-system/list-table";
import { Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";

import {
  type OrganizationBraidRow,
  braidAuditHref,
  braidFromText,
} from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";
import { BraidProjectLabel } from "../../elements/braid-project.tsx";

function day(ms: number): string {
  return format(ms, "d MMM yyyy");
}

export function OrganizationBraidsTable({
  rows,
  paused,
}: {
  rows: readonly OrganizationBraidRow[];
  paused: boolean;
}) {
  return (
    <ListTable variant="embedded" aria-label="Braids in this organisation">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>From</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Into</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Condition</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Access</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>History</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => (
          <ListTable.Row key={row.braidId} data-testid="organization-braid-row">
            <ListTable.Cell>
              <BraidProjectLabel project={row.owner} detail={`Since ${day(row.createdAtMs)}`} />
            </ListTable.Cell>
            <ListTable.Cell>
              <BraidProjectLabel project={row.reader} />
            </ListTable.Cell>
            <ListTable.Cell>
              <BraidCondition where={row.where} />
            </ListTable.Cell>
            <ListTable.Cell>
              <Text fontSize="sm" color="fg.muted">
                {paused ? "Paused · " : ""}
                {braidFromText({ fromMs: row.fromMs, showsTime: row.fromShowsTime })}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {row.expiresAtMs === null ? "No end date" : `Until ${day(row.expiresAtMs)}`}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Link href={braidAuditHref(row.braidId)} fontSize="sm">
                View in audit log
              </Link>
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
