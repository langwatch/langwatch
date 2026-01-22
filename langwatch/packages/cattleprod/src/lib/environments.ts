export type Environment = "local" | "dev" | "prod";

export interface EnvironmentConfig {
  name: string;
  description: string;
  usePortForward: boolean;
}

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  local: {
    name: "Local",
    description: "Local Redis (localhost:6379)",
    usePortForward: false,
  },
  dev: {
    name: "Development",
    description: "AWS Dev environment",
    usePortForward: false,
  },
  prod: {
    name: "Production",
    description: "Production via kubectl port-forward",
    usePortForward: true,
  },
};

export function getEnvironmentConfig(env: Environment): EnvironmentConfig {
  return ENVIRONMENTS[env];
}

export function isValidEnvironment(env: string): env is Environment {
  return env in ENVIRONMENTS;
}
