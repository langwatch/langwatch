// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** A fixed-window count of calls under one key; `allowed` turns false past `max` in the window. */
export interface DigestCallCounterRepository {
  count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>>;
}
