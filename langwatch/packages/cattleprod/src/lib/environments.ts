export type Environment = "local" | "dev" | "staging" | "prod";

export interface EnvironmentConfig {
  name: string;
  description: string;
  usePortForward: boolean;
  useAwsSecrets: boolean;
  redisUrl?: string;
  awsProfile?: string;
  secretName?: string;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  local: {
    name: "Local",
    description: "Local Redis (localhost:6379)",
    usePortForward: false,
    useAwsSecrets: false,
    redisUrl: "redis://localhost:6379",
  },
  dev: {
    name: "Development",
    description: "AWS Dev environment",
    usePortForward: false,
    useAwsSecrets: true,
    awsProfile: "lw-dev",
    secretName: "langwatch/dev/redis",
  },
  staging: {
    name: "Staging",
    description: "Staging via kubectl port-forward",
    usePortForward: true,
    useAwsSecrets: false,
  },
  prod: {
    name: "Production",
    description: "Production via kubectl port-forward",
    usePortForward: true,
    useAwsSecrets: false,
  },
};

export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
  return ENVIRONMENTS[env];
}

export function isValidEnvironment(env: string): env is Environment {
  return env in ENVIRONMENTS;
}
