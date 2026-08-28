/**
 * The instance administrator credential, read per request.
 *
 * Per request rather than at boot so a deployment (or a test) that sets it
 * after start-up is honoured; blank counts as unset. The same variable is
 * declared in the env schema for validation and documentation.
 *
 * Never logged, never echoed: the only consumer is the constant-time compare
 * in the packaged `/api/organizations` family.
 */
export function instanceAdminApiKey(): string | undefined {
  const key = process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY?.trim();
  return key ? key : undefined;
}
