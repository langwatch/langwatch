export abstract class AutomationIntentRetentionPort {
  abstract deleteDispatchedBefore(input: { processName: string; before: number }): Promise<number>;
}
