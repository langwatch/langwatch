/**
 * The one word a process says about its stores, and the only choice it has.
 *
 * `"live"` reaches the real stores; `"memory"` stands them in. Neither names a
 * database: no module ever chooses between Postgres and ClickHouse, because
 * each repository has exactly one live store, already stated by the folder it
 * sits in and by what its factory requires.
 *
 * There is no default and no fallback. An absence cannot select a tier,
 * because an API serving empty lists out of memory looks healthy and is the
 * worst failure this design can have.
 */
export type Tier = "live" | "memory";
