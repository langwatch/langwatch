export abstract class AutomationIntentRetentionRepository {
  abstract deleteDispatchedBefore(input: { processName: string; before: number }): Promise<number>;
}
