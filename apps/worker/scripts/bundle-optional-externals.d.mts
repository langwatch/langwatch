/**
 * Types for the JavaScript module the build script and the bundle's resolution
 * guard both read. The list itself stays JavaScript because `build-server.mjs`
 * runs on plain `node`, before any TypeScript toolchain is available.
 */
export declare const OPTIONAL_EXTERNALS: readonly string[];
