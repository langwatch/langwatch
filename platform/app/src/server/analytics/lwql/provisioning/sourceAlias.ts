/**
 * The alias a LangWatchQL view body gives its primary source table.
 *
 * A leaf module with no imports on purpose. A hand-written catalog view (e.g.
 * `coding_tool_results`) references this to build its `ON`/`where` SQL, and the
 * statement builder ({@link ./catalogStatements}) builds the `FROM` with it.
 * Keeping the constant here — rather than on the statement builder, which also
 * imports the catalog — stops a catalog entry from importing that builder and
 * closing an import cycle (catalogStatements -> lwqlViews -> overrides ->
 * catalogStatements). That cycle left a catalog entry `undefined` whenever an
 * overrides module happened to be the first one initialised, which crashed any
 * test that imported it before the rest of the catalog.
 */
export const LWQL_SOURCE_ALIAS = "src";
