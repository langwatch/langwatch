import { env } from "../env.mjs";

export const isFeatureEnabled = (envVar: string) => {
  if (typeof window !== undefined && window.location.search.includes(envVar)) {
    const params = new URLSearchParams(window.location.search);
    return params.get(envVar) === "1";
  }

  return !!env[envVar as keyof typeof env];
};
