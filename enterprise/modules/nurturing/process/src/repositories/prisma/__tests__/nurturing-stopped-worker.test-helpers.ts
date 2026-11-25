// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The client with its second raw write rejected, as a worker stopping between a write and its
 * re-check leaves it: the write lands and the re-check never runs, so only the write's own mark
 * check keeps the erased person off the row.
 */
export function stoppedBeforeRecheck<Client extends object>(client: Client): Client {
  const stopped = new Error("the worker stopped before its re-check");
  let writes = 0;
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (property !== "$executeRaw" || typeof value !== "function") return value;
      return (...args: unknown[]) => {
        writes += 1;
        if (writes === 2) return Promise.reject(stopped);
        return value.apply(target, args);
      };
    },
  });
}
