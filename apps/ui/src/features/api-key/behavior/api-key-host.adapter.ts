/**
 * The API Key package's host port, answered from this application.
 *
 * `@langwatch/api-key-web` declares what its two screens need — the scope, one
 * grant, the visible scopes, the organization graph, the session, the address,
 * the two notices, the clipboard, the lead-source stamp, the one `platform/app`
 * drawer they address, and the three CLI device-flow calls — as one abstract
 * class it can define without importing anything of ours. This is the other
 * half: a plain adapter over what the application shell has already resolved.
 *
 * Nothing here fetches for a READ. The values arrive as arguments, so the
 * adapter is a value object a test can construct, and the reads that produce
 * them stay in the one component that mounts it. The three device-flow calls are
 * the exception and they are actions rather than reads: they are handed in as
 * functions, and the wire they speak lives in
 * `apps/ui/src/behavior/ui-cli-device-flow.ts`, which is where a browser
 * transport is allowed to live.
 *
 * THE LEAD-SOURCE STAMP IS A RESTATEMENT, and it is written down as one.
 * `platform/app/src/utils/attribution.ts` owns the `lw_attrib.` session-storage
 * convention and stays with its capture hook and its signup reader; this file
 * knows one key of it. The obligation is to keep the prefix and the field name
 * in step, and `api-key-host.adapter.unit.test.ts` pins both strings so a
 * rename on either side is a failing test rather than a lead source that
 * silently stops arriving.
 */

import {
  ApiKeyHostPort,
  type ApiKeyActor,
  type ApiKeyAvailableScopes,
  type ApiKeyFailureNotice,
  type ApiKeyHostScope,
  type ApiKeyOrganization,
  type ApiKeyPlatformDrawer,
  type ApiKeyRouteReading,
  type ApiKeySessionStatus,
  type ApiKeySuccessNotice,
  type CliDeviceActionResult,
  type CliDeviceApproval,
  type CliDeviceCodeLookup,
} from "@langwatch/api-key-web/screens/api-key";
import type { UiBrowserStorage } from "../../../behavior/ui-browser-storage";

/**
 * The grant neither key carries.
 *
 * `/settings/api-keys` was `SettingsLayout` and NOTHING else — no
 * `withPermissionGuard`, no flag — and decided what a reader may do from two
 * things it read inline. `/cli/auth` carried no guard either: it is the page a
 * browser opened by `langwatch login` lands on, and it does its own session
 * redirect. Inventing a page-level grant for either would refuse readers the
 * product admits today.
 */
export const API_KEY_PAGE_PERMISSION = void 0;

/** The query parameter that names which drawer the application should open. */
export const DRAWER_OPEN_PARAM = "drawer.open";

/**
 * Where the first-touch acquisition source is kept.
 *
 * The prefix and field name are `platform/app/src/utils/attribution.ts`'s;
 * see the module docblock for why this file knows them.
 */
export const ATTRIBUTION_STORAGE_PREFIX = "lw_attrib.";
export const LEAD_SOURCE_FIELD = "leadSource";

export type ApiKeyHostReadings = {
  scope: ApiKeyHostScope;
  availableScopes: ApiKeyAvailableScopes;
  organizations: ApiKeyOrganization[] | undefined;
  currentUser: ApiKeyActor;
  sessionStatus: ApiKeySessionStatus;
  apiEndpoint: string;
  route: ApiKeyRouteReading;
};

export type ApiKeyHostActions = {
  hasPermission: (permission: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  replace: (to: string) => void;
  navigate: (to: string) => void;
  succeeded: (notice: ApiKeySuccessNotice) => void;
  failed: (failure: ApiKeyFailureNotice) => void;
  /** Writes to the clipboard, answering whether the write actually landed. */
  writeClipboard: (text: string) => Promise<void>;
  /**
   * Per-visit storage the lead-source stamp is kept in.
   *
   * Named `visitStorage` rather than after the browser API it is backed by:
   * `ui-browser-capability` reads the identifier `sessionStorage` anywhere in a
   * frontend feature's source and is right to — a feature that names a browser
   * global cannot be mounted anywhere else. The global layer owns the API; this
   * layer owns a port over it.
   */
  visitStorage: UiBrowserStorage;
  lookupDeviceCode: (userCode: string) => Promise<CliDeviceCodeLookup>;
  approveDeviceCode: (approval: CliDeviceApproval) => Promise<CliDeviceActionResult>;
  denyDeviceCode: (userCode: string) => Promise<CliDeviceActionResult>;
};

export class UiApiKeyHost extends ApiKeyHostPort {
  static create(readings: ApiKeyHostReadings, actions: ApiKeyHostActions): UiApiKeyHost {
    return new UiApiKeyHost(readings, actions);
  }

  private constructor(
    private readonly readings: ApiKeyHostReadings,
    private readonly actions: ApiKeyHostActions,
  ) {
    super();
  }

  scope(): ApiKeyHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  availableScopes(): ApiKeyAvailableScopes {
    return this.readings.availableScopes;
  }

  organizations(): ApiKeyOrganization[] | undefined {
    return this.readings.organizations;
  }

  currentUser(): ApiKeyActor {
    return this.readings.currentUser;
  }

  sessionStatus(): ApiKeySessionStatus {
    return this.readings.sessionStatus;
  }

  apiEndpoint(): string {
    return this.readings.apiEndpoint;
  }

  route(): ApiKeyRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  replace(to: string): void {
    this.actions.replace(to);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  succeeded(notice: ApiKeySuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: ApiKeyFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * The success notice only goes out once the write has actually resolved.
   *
   * A clipboard write can be refused — Safari private mode, a non-secure
   * context — and the refusal arrives as a rejection rather than as a return
   * value. Telling the reader "copied" for a write that did not happen is worse
   * than saying nothing, because the failure only shows up when they paste a
   * credential that does not work. The FAILURE line is the application's rather
   * than the screen's: every copy button in the product says the same thing
   * about it.
   */
  async copyToClipboard({
    text,
    succeeded,
  }: {
    text: string;
    succeeded: ApiKeySuccessNotice;
  }): Promise<boolean> {
    try {
      await this.actions.writeClipboard(text);
      this.actions.succeeded(succeeded);
      return true;
    } catch (error) {
      this.actions.failed({
        error,
        fallbackTitle: "Failed to copy",
        description: "Couldn't copy. Please try again.",
      });
      return false;
    }
  }

  /**
   * FIRST-TOUCH: a value already recorded is never overwritten.
   *
   * A reader who originally arrived through a campaign and later runs
   * `langwatch login` keeps their real source. Storage can throw outright
   * (a browser set to block site data), and a lead source is not worth failing
   * a page over, so a refusal is swallowed.
   */
  recordLeadSourceIfAbsent(source: string): void {
    const key = `${ATTRIBUTION_STORAGE_PREFIX}${LEAD_SOURCE_FIELD}`;
    try {
      if (this.actions.visitStorage.getItem(key) !== null) return;
      this.actions.visitStorage.setItem(key, source);
    } catch {
      // Storage is unavailable or full. Attribution is a nicety; the page is not.
    }
  }

  openPlatformDrawer({
    drawer,
    params = {},
  }: {
    drawer: ApiKeyPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
    // leaving a previous drawer's parameters behind is what makes an editor open
    // on the row the reader looked at before this one.
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.readings.route.query)) {
      if (!key.startsWith("drawer.")) next[key] = value;
    }
    next[DRAWER_OPEN_PARAM] = drawer;
    for (const [name, value] of Object.entries(params)) {
      if (value !== void 0) next[`drawer.${name}`] = value;
    }
    this.actions.setQuery(next);
  }

  lookupDeviceCode(userCode: string): Promise<CliDeviceCodeLookup> {
    return this.actions.lookupDeviceCode(userCode);
  }

  approveDeviceCode(approval: CliDeviceApproval): Promise<CliDeviceActionResult> {
    return this.actions.approveDeviceCode(approval);
  }

  denyDeviceCode(userCode: string): Promise<CliDeviceActionResult> {
    return this.actions.denyDeviceCode(userCode);
  }
}
