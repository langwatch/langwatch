/**
 * A schedule the operator switched off, named by what it fires.
 *
 * In `model` rather than beside the section that renders it because the hook
 * that READS the rows needs the same shape, and a feature's `behavior` layer may
 * not depend on its `ui` — a rule worth keeping even for a type, since it is
 * what stops a data shape from being defined by whichever component happened to
 * draw it first.
 */
export interface PausedSchedule {
  id: string;
  targetType: string;
  targetId: string;
  cron: string;
}
