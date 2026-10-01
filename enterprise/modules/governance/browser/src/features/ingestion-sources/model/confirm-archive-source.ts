// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one question asked before a source is archived, wherever the action is
 * offered.
 *
 * Archiving is offered on two screens, and each used to own its own copy of
 * this: the detail page asked, the table's row menu did not, so the same
 * action cost one click on one screen and two on the other — and the cheaper
 * one was the one with no way back. The wording lives here so the two cannot
 * drift apart again.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       ("Archiving from the row asks the same question the detail page asks")
 */
export function confirmArchiveSource({ name }: { name: string }): boolean {
  return confirm(`Archive "${name}"? Historical events stay readable.`);
}
