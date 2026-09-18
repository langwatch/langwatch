/**
 * The port that the Secrets screen asks from its host application. Encapsulates browser
 * capabilities the host resolves (avoiding restricted imports like @langwatch/ui, router,
 * toast). Unique among host ports: includes switchProject for per-project scoping.
 */

import { createContext, useContext } from "react";

/** The project the secrets on screen belong to. */
export type SecretHostScope = {
  projectId: string | undefined;
  projectName: string | undefined;
};

/** A short confirmation of something the reader just did. */
export type SecretSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure as the screen knows it. Carries the raw error code (never customer-facing
 * prose) plus fallbackTitle and description. Screen supplies the description since the
 * host cannot safely look up copy for errors. See model/secret-refusal-copy.ts.
 */
export type SecretFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

/** The one thing the screen is handed. */
export abstract class SecretHostApi {
  /** The project these secrets belong to. */
  abstract scope(): SecretHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  abstract succeeded(notice: SecretSuccessNotice): void;

  abstract failed(failure: SecretFailureNotice): void;

  /**
   * Offers the reader a way to change which project they are looking at, or `null` if
   * the application has no switcher to offer. The ability travels; the application supplies
   * the control since screens cannot name org graph, router, or shell scope memory.
   */
  abstract projectSwitcher(): React.ReactNode | null;
}

const SecretHostContext = createContext<SecretHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const SecretHostProvider = SecretHostContext.Provider;

export function useSecretHost(): SecretHostApi {
  const host = useContext(SecretHostContext);
  if (!host) {
    throw new Error(
      "No Secret host is mounted above this screen; render it inside the secret frontend feature.",
    );
  }
  return host;
}

/** The grant every write control on this page is behind. */
export const SECRET_MANAGE_PERMISSION = "secrets:manage";
