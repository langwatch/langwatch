/**
 * The port interface for the Data Privacy screen; every scope is writable with
 * no plan gate or platform-admin capability. The plan is read only for the
 * self-hosted PII redaction model, which comes with the Enterprise licence.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type PrivacyHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
};

/** The path parameters and query string the screen was opened with. */
export type PrivacyRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type PrivacySuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it. The raw `error` travels — the wire
 * message of a handled error is its code slug, so composing copy from it
 * would print the slug. `fallbackTitle` names the action that failed.
 */
export type PrivacyFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * Whether the organization holds an Enterprise licence: not answered yet, held, not held, or
 * unknown (the plan could not be read, or this reader may not read it).
 */
export type PrivacyLicence = "loading" | "enterprise" | "none" | "unknown";

/** The currency the organization's subscription is billed in, which Strict's price is quoted in. */
export type PrivacyBillingCurrency = "USD" | "EUR";

/** The currency as the host reads it: "loading" until the plan answers, so no price flashes. */
export type PrivacyBillingCurrencyReading = PrivacyBillingCurrency | "loading";

/** The one thing the screen is handed. */
export abstract class DataPrivacyHostApi {
  /** The organization, team and project this page is about. */
  abstract scope(): PrivacyHostScope;

  abstract route(): PrivacyRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract succeeded(notice: PrivacySuccessNotice): void;

  abstract failed(failure: PrivacyFailureNotice): void;

  /** Self-hosted only; on LangWatch Cloud the plan is not read and this is "unknown". */
  abstract licence(): PrivacyLicence;

  /** Whether this reader may activate a licence, so the advert links there. */
  abstract mayManageLicence(): boolean;

  /** Euros only for a euro Growth subscription, "loading" until the plan answers, else dollars. */
  abstract billingCurrency(): PrivacyBillingCurrencyReading;
}

const DataPrivacyHostContext = createContext<DataPrivacyHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const DataPrivacyHostProvider = DataPrivacyHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means it was rendered outside
 * the frontend feature that owns it — a composition fault, not something a
 * screen can degrade around.
 */
export function useDataPrivacyHost(): DataPrivacyHostApi {
  const host = useContext(DataPrivacyHostContext);
  if (!host) {
    throw new Error(
      "No Data Privacy host is mounted above this screen; render it inside the data-privacy frontend feature.",
    );
  }
  return host;
}
