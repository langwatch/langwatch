import type { UserAvatarMediaType } from "@langwatch/user-contract";
import { UserAvatarStoragePort } from "@langwatch/user-server";

/**
 * The user service's avatar storage on a process that composes no stored-object
 * application.
 *
 * It refuses, loudly and by name. This process composes the user service to
 * READ — the browser-session boundary resolves a signed-in person's stored
 * profile through it — and a read needs no object store. Writing an avatar
 * does: the bytes become a stored object with a purpose, an owner and an
 * audience, and that application is not one this package can build.
 *
 * The two alternatives are both worse. Refusing to compose the user service at
 * all would take the browser-session boundary down over a capability it never
 * calls; accepting the bytes and dropping them would answer a customer's
 * upload with success and no picture.
 *
 * The refusal is a plain `Error` on purpose. Nothing the caller sends causes it
 * and nothing they can send avoids it — it is a fact about which tier is
 * serving them — so it degrades to a generic failure carrying the trace id
 * rather than dressing a deployment shape up as a customer's mistake.
 */
export class UnavailableApiUserAvatarStorageAdapter extends UserAvatarStoragePort {
  static create(options: {
    /** Names the process in the refusal, so a stack trace says whose gap this is. */
    processName: string;
  }): UnavailableApiUserAvatarStorageAdapter {
    return new UnavailableApiUserAvatarStorageAdapter(options.processName);
  }

  private constructor(private readonly processName: string) {
    super();
  }

  store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    return Promise.reject(
      new Error(
        `${this.processName} composes no stored-object application, so it cannot store the avatar uploaded for user "${input.userId}". Upload it through a process that composes stored objects.`,
      ),
    );
  }
}
