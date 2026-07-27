import * as SecureStore from "expo-secure-store";

import {
  isAccessTokenExpired,
  parseStoredSession,
  type StoredSession,
} from "@/lib/session";

import { DeviceFlowError, refreshSession } from "./deviceFlow";

const KEY = "device-session";

/**
 * The only thing allowed to read, write or refresh the stored session.
 *
 * Refresh MUST be serialized: the server rotates the refresh token on every
 * call, so two screens each noticing an expired access token at the same moment
 * would race, and the loser would be left holding a token the server has
 * already retired. `inFlightRefresh` collapses concurrent callers onto one
 * refresh and hands them all the same result.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate: these tokens grant read access
 * to platform-wide ops data, so they must not ride a keychain sync to another
 * device.
 */
class SessionStore {
  private cached: StoredSession | null = null;
  private loaded = false;
  private inFlightRefresh: Promise<StoredSession> | null = null;

  async current(): Promise<StoredSession | null> {
    if (this.loaded) return this.cached;
    const raw = await SecureStore.getItemAsync(KEY);
    this.cached = parseStoredSession(raw);
    this.loaded = true;
    return this.cached;
  }

  async store(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    this.cached = session;
    this.loaded = true;
  }

  async clear(): Promise<void> {
    this.inFlightRefresh = null;
    this.cached = null;
    this.loaded = true;
    await SecureStore.deleteItemAsync(KEY);
  }

  /**
   * A session whose access token is good to use right now, or null when there
   * is nothing usable and the caller should go back to sign-in.
   *
   * `force` is for the 401 path: the token looked valid by its own clock but the
   * server disagreed — a revocation, or a clock that drifted — so refresh
   * regardless of what the expiry says.
   */
  async valid({ force = false }: { force?: boolean } = {}): Promise<
    StoredSession | null
  > {
    const session = await this.current();
    if (!session) return null;
    if (!force && !isAccessTokenExpired(session)) return session;

    if (this.inFlightRefresh) {
      try {
        return await this.inFlightRefresh;
      } catch {
        return null;
      }
    }

    this.inFlightRefresh = refreshSession(session).then(async (refreshed) => {
      await this.store(refreshed);
      return refreshed;
    });

    try {
      return await this.inFlightRefresh;
    } catch (error) {
      // A rejected refresh token is terminal: nothing the app holds can recover
      // it, so drop the session rather than leaving a dead credential in the
      // keystore to fail every subsequent screen.
      if (
        error instanceof DeviceFlowError &&
        error.kind === "refresh_rejected"
      ) {
        await this.clear();
      }
      return null;
    } finally {
      this.inFlightRefresh = null;
    }
  }
}

export const sessionStore = new SessionStore();
