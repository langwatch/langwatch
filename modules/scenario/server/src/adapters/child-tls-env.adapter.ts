/**
 * Resolves child TLS configuration without reading ambient environment.
 * A configured local CA preserves verification and always wins. Disabling
 * verification is permitted only for local, non-SaaS development; production
 * and hosted children receive neither override.
 */

export interface ChildTlsEnvInput {
  /** The app's IS_SAAS flag — true on the hosted product, false on-prem/local. */
  isSaaS: boolean;
  /** NODE_ENV supplied by parent process composition. */
  nodeEnv: string | undefined;
  /** NODE_EXTRA_CA_CERTS supplied by parent process composition. */
  nodeExtraCaCerts: string | undefined;
}

export interface ChildTlsEnv {
  NODE_EXTRA_CA_CERTS?: string;
  NODE_TLS_REJECT_UNAUTHORIZED?: string;
}

export class ChildTlsEnvAdapter {
  static create(): ChildTlsEnvAdapter {
    return new ChildTlsEnvAdapter();
  }

  private constructor() {}

  static resolve(input: ChildTlsEnvInput): ChildTlsEnv {
    const { isSaaS, nodeEnv, nodeExtraCaCerts } = input;

    // Preferred: a trusted local CA is available — forward it, keep verification ON.
    if (nodeExtraCaCerts && nodeExtraCaCerts.trim().length > 0) {
      return { NODE_EXTRA_CA_CERTS: nodeExtraCaCerts };
    }

    // Fallback: local, non-SaaS dev ONLY. Never in production, never in SaaS.
    const isLocalDev = !isSaaS && nodeEnv !== "production";
    if (isLocalDev) {
      return { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    }

    // Hosted / SaaS / production: never relax TLS, never inject a CA override.
    return {};
  }
}

export const resolveChildTlsEnv = ChildTlsEnvAdapter.resolve;
