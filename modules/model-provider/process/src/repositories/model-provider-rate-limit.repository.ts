/** One fixed window, counted wherever the process counts its windows. */
export abstract class ModelProviderRateLimitRepository {
  abstract consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }>;
}
