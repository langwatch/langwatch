/** Paused schedule (in model because behavior hook needs same shape; behavior cannot
 * depend on ui). */
export interface PausedSchedule {
  id: string;
  targetType: string;
  targetId: string;
  cron: string;
}
