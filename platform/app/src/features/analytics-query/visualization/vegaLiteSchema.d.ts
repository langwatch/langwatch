/**
 * The bundled Vega-Lite v6 JSON Schema, declared rather than inferred.
 *
 * `resolveJsonModule` would otherwise have TypeScript parse 1.4MB of schema and
 * infer a literal type for all 458 definitions on every typecheck, for a value
 * that is only ever handed to Ajv as an opaque schema object.
 *
 * The export path is the one `vega-lite`'s own `exports` map publishes: the file
 * lives at `build/vega-lite-schema.json` on disk but is reachable only as
 * `vega-lite/vega-lite-schema.json`.
 */
declare module "vega-lite/vega-lite-schema.json" {
  const schema: Record<string, unknown>;
  export default schema;
}
