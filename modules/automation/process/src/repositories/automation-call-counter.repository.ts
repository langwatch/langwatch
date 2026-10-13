/** A fixed-window count of calls under one key, as the authoring surface limits them. */
export abstract class AutomationCallCounterRepository {
  abstract count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}
