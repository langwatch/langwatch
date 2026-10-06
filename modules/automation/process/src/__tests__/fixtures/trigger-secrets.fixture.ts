import type {
  TriggerSecretCipher,
  TriggerSecretSeal,
} from "../../repositories/trigger.repository.ts";

/** The trigger repository's two secret operations over a test's own reversible cipher. */
export function sealWith(cipher: TriggerSecretCipher): TriggerSecretSeal {
  return {
    openSecret: ({ sealed }) => cipher.decrypt(sealed),
    sealSecret: ({ plain }) => cipher.encrypt(plain),
  };
}
