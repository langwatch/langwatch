export abstract class AutomationIntentRetention {
  abstract deleteDispatchedBefore(input: { processName: string; before: number }): Promise<number>;
}
