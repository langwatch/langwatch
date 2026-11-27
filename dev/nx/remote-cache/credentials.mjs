// AWS credentials for the cache server in CI: the OIDC session the nx-remote-cache action
// passes in the environment. Laptops hold none; they go through the cache gate (gate.mjs).
const REFRESH_BEFORE_MS = 5 * 60_000;

const fromEnvironment = (env) =>
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN || undefined,
        expiration: env.AWS_CREDENTIAL_EXPIRATION
          ? Date.parse(env.AWS_CREDENTIAL_EXPIRATION)
          : undefined,
      }
    : null;

// Credentials that are about to expire count as none: a miss beats a failed request.
export const credentialSource = ({ env, now = Date.now }) => {
  const current = fromEnvironment(env);
  return async () =>
    current && (!current.expiration || current.expiration - now() > REFRESH_BEFORE_MS)
      ? current
      : null;
};
