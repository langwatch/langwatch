export abstract class AnomalyFeatureFlagsPort {
  abstract isEnabled(
    key: string,
    input: {
      distinctId: string;
      defaultValue: boolean;
      cacheTtlMs: number;
    },
  ): Promise<boolean>;
}

export interface AnomalyFeatureFlagConfig {
  killSwitchCacheTtlMs: number;
}
