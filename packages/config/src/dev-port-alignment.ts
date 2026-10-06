/**
 * A development stack's own address, realigned onto the port it is serving.
 * Stale only means a plain `http://localhost:<port>`: any other address is deliberate.
 * @see specs/auth/dev-port-origin-alignment.feature
 */
const ALIGNED_NAMES = ["BASE_HOST", "NEXTAUTH_URL", "LANGWATCH_ENDPOINT"] as const;

export type DevAddressRealignment = Readonly<{ name: string; from: string; to: string }>;

export type DevAddressAlignment = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  realigned: readonly DevAddressRealignment[];
}>;

function isPlainLocalhostUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" && parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

/**
 * Returns the environment with the app's own addresses on the port in use, and what changed.
 * A copy: the input is never written, so the caller decides who sees the aligned values.
 */
export function alignDevAuthUrlsToPort({
  environment,
}: {
  environment: Readonly<Record<string, string | undefined>>;
}): DevAddressAlignment {
  const port = environment.LANGWATCH_APP_PORT ?? environment.PORT;
  if (environment.NODE_ENV !== "development" || !port) return { environment, realigned: [] };

  const target = `http://localhost:${port}`;
  const aligned = { ...environment };
  const realigned: DevAddressRealignment[] = [];

  for (const name of ALIGNED_NAMES) {
    const current = environment[name];
    if (!current || current === target || !isPlainLocalhostUrl(current)) continue;
    aligned[name] = target;
    realigned.push({ name, from: current, to: target });
  }

  return { environment: aligned, realigned };
}
