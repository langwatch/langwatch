// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { StoredProjection, StoredProjectionRead } from "@langwatch/eventing";

/** The cursor columns every week fold row carries beside its state. */
export type DigestWeekRow = Readonly<{
  state: unknown;
  occurredAt: Date;
  lastEventId: string;
  acceptedAt: Date;
  projectionVersion: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export function weekCursorColumns<State>(
  projection: StoredProjection<State>,
): Omit<DigestWeekRow, "state"> {
  return {
    occurredAt: new Date(projection.occurredAt),
    lastEventId: projection.cursor.eventId,
    acceptedAt: new Date(projection.cursor.acceptedAt),
    projectionVersion: projection.version,
    createdAt: new Date(projection.createdAt),
    updatedAt: new Date(projection.updatedAt),
  };
}

export function readWeekRow<State>({
  row,
  state,
}: {
  row: DigestWeekRow;
  state: State;
}): StoredProjectionRead<State> {
  return {
    kind: "folded",
    projection: {
      state,
      cursor: { acceptedAt: row.acceptedAt.getTime(), eventId: row.lastEventId },
      occurredAt: row.occurredAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion,
    },
  };
}
