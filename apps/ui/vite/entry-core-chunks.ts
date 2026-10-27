/**
 * Packs the code the first paint needs into a few chunks instead of ~150 files: on a lossy
 * link each file is a request to drop, and a dropped static import leaves the page blank.
 * Spec: specs/ui/boot-recovery.feature
 */

/** The slice of Rolldown's module info this needs. */
export type CoreModuleInfo = {
  readonly isEntry: boolean;
  readonly importers: readonly string[];
  readonly dynamicImporters: readonly string[];
  readonly importedIds: readonly string[];
};

export type CoreChunkContext = {
  getModuleInfo(moduleId: string): CoreModuleInfo | null;
};

/**
 * `core` swallows every dependency its modules run, third-party ones too. What is left for
 * `core-vendor` is third-party code the closure names but only screens use (the UI kit),
 * one shared file instead of dozens of small ones.
 */
export const ENTRY_CORE_CHUNKS = { vendor: "core-vendor", app: "core" } as const;

/** Every module reachable through an edge list, breadth first from `from`. */
function reach({
  from,
  next,
}: {
  from: readonly string[];
  next: (id: string) => readonly string[];
}): Set<string> {
  const seen = new Set(from);
  const queue = [...from];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const neighbour of next(id)) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen;
}

/**
 * The entries' static import closure, found from any one module: up through every importer
 * to the entries, then down through static imports only.
 */
export function entryStaticClosure({
  anyModule,
  ctx,
}: {
  anyModule: string;
  ctx: CoreChunkContext;
}): Set<string> {
  const info = (id: string) => ctx.getModuleInfo(id);
  const ancestors = reach({
    from: [anyModule],
    next: (id) => [...(info(id)?.importers ?? []), ...(info(id)?.dynamicImporters ?? [])],
  });
  const entries = [...ancestors].filter((id) => info(id)?.isEntry === true);
  const closure = reach({ from: entries, next: (id) => info(id)?.importedIds ?? [] });
  for (const entry of entries) closure.delete(entry);
  return closure;
}

/**
 * A Rolldown `codeSplitting` group naming each module of the entries' static closure into
 * the vendor or the app core chunk. One namer serves one build: the closure is worked out
 * on its first call.
 */
export function entryCoreChunkGroup({ priority }: { priority: number }) {
  let closure: Set<string> | undefined;
  return {
    name: (id: string, ctx: CoreChunkContext): string | null => {
      closure ??= entryStaticClosure({ anyModule: id, ctx });
      if (!closure.has(id)) return null;
      return /[\\/]node_modules[\\/]/.test(id) ? ENTRY_CORE_CHUNKS.vendor : ENTRY_CORE_CHUNKS.app;
    },
    // No `maxSize`: splitting the core cut across import cycles and broke boot ("x is not a
    // function"), so it stays one file.
    priority,
  };
}

/** Every module's host mount, by the `<name>-host-mount.tsx` convention its declaration follows. */
export const HOST_MOUNT_MODULE = /-host-mount\.tsx$/;

/**
 * The host mounts in one chunk. The root renders every one of them on every page, so as
 * separate files they were ~90 requests before the first paint, for no bytes saved.
 */
export function hostMountsChunkGroup({ priority }: { priority: number }) {
  return { name: "host-mounts", test: HOST_MOUNT_MODULE, priority };
}
