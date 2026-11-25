import { execFile } from "node:child_process";

// AWS credentials for the cache server. CI passes the OIDC session in the environment;
// a laptop names a profile and the AWS CLI resolves it (SSO included). A failure turns
// the cache off for a while instead of asking again on every task.
const RETRY_AFTER_MS = 10 * 60_000;
const REFRESH_BEFORE_MS = 5 * 60_000;

export const fromEnvironment = (env) =>
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

export const parseProcessCredentials = (stdout) => {
  const json = JSON.parse(stdout);
  if (!json.AccessKeyId || !json.SecretAccessKey)
    throw new Error("no credentials in the AWS CLI output");
  return {
    accessKeyId: json.AccessKeyId,
    secretAccessKey: json.SecretAccessKey,
    sessionToken: json.SessionToken || undefined,
    expiration: json.Expiration ? Date.parse(json.Expiration) : undefined,
  };
};

const exportProfile = (profile) =>
  new Promise((resolve, reject) => {
    execFile(
      "aws",
      ["configure", "export-credentials", "--profile", profile, "--format", "process"],
      { timeout: 15_000 },
      (error, stdout) => (error ? reject(error) : resolve(parseProcessCredentials(stdout))),
    );
  });

export const credentialSource = ({
  profile,
  env,
  now = Date.now,
  load = exportProfile,
  log = () => {},
}) => {
  let current = profile ? null : fromEnvironment(env);
  let failedAt = 0;
  let pending = null;
  const fresh = (c) => c && (!c.expiration || c.expiration - now() > REFRESH_BEFORE_MS);
  return async () => {
    if (fresh(current)) return current;
    if (!profile) return null;
    if (failedAt && now() - failedAt < RETRY_AFTER_MS) return null;
    pending ??= load(profile)
      .then((c) => {
        current = c;
        failedAt = 0;
        return c;
      })
      .catch((error) => {
        failedAt = now();
        log(`credentials for profile ${profile} unavailable: ${error.message}`);
        return null;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
};
