/**
 * Which projects the reader could replicate a thing into, as a capability of
 * its own: organization lends it by declaration and the shell installs it
 * beside scope. ARCHITECTURE.md §10.1 "A capability travels by declaration".
 */

/** One project on a team the reader belongs to, and whether they may create there. */
export type UiCopyTarget = {
  projectId: string;
  projectSlug: string;
  /** "Organization / Team / Project", as every replicate select renders it. */
  label: string;
  /** The reader's own effective permissions in this project grant the one asked. */
  mayCreate: boolean;
};

/** Every project the reader could replicate into, graded by one permission. */
export abstract class UiCopyTargets {
  /** Undefined while nothing answers: no organization graph has landed. */
  abstract targets(permission: string): readonly UiCopyTarget[] | undefined;
}

class AbsentUiCopyTargets extends UiCopyTargets {
  targets(): undefined {
    return void 0;
  }
}

/** A composition that installed no lender: absence stays sayable, never an empty list. */
export const ABSENT_UI_COPY_TARGETS: UiCopyTargets = new AbsentUiCopyTargets();
