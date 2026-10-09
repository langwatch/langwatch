// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The `SCIM_V2_GRANTS` rollback lever (D08), read per call rather than
 * captured at module load so a restart-free rollout can flip it.
 *
 * What it decides is narrow and deliberate: WHO WRITES MEMBERSHIP.
 *
 *   off   the previous write path — the hand-written `OrganizationUser` row
 *         with its unconditional `MEMBER` role, and a deprovision that goes
 *         at the ledger writer directly, so the empty proof never runs.
 *   on    every membership consequence goes through `GrantsService`: the
 *         role is the one the directory's mapping asserts, and BOTH removal
 *         paths (a delete and a push marking somebody inactive) run the
 *         offboard proof.
 *
 * What it does NOT decide: connection scoping and the directory-sync
 * history. A token reaching only its own connection is a safety property,
 * and a safety property behind a rollback lever is one that is off when it
 * is needed. The history is on for the same reason — a projection that only
 * started recording when the flag flipped would have no past to show on the
 * day somebody asked what happened.
 */
import { env } from "~/env.mjs";

export function scimGrantsWritePathEnabled(): boolean {
  return env.SCIM_V2_GRANTS === "on";
}
