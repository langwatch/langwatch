/**
 * A Uint8Array subclass holding serialized JSON bytes that provides
 * string method compatibility for customer middleware.
 *
 * Middleware historically observed `request.body` as a string for JSON
 * protocol services. This class preserves that contract: string methods
 * and coercion (template literals, `+` operator) lazily decode the bytes
 * to a cached string. The HTTP transport layer still sees a Uint8Array
 * and sends raw bytes without conversion.
 *
 * @internal
 * @deprecated this adapter will be removed in a future version.
 */
export declare class JsonBytesStringAdapter extends Uint8Array {
    private string;
    static allocUnsafe(bytes: number): JsonBytesStringAdapter;
    /**
     * Enables string coercion via template literals and `+` operator.
     */
    toString(): string;
    /**
     * Enables string coercion in comparison and arithmetic contexts.
     * @returns a string. The signature is set to avoid incompatibility with extending Uint8Array.
     */
    valueOf(): any;
    includes(searchString: string | number, position?: number): boolean;
    indexOf(searchString: string | number, position?: number): number;
    lastIndexOf(searchString: string | number, position?: number): number;
    startsWith(searchString: string, position?: number): boolean;
    endsWith(searchString: string, endPosition?: number): boolean;
    match(regexp: string | RegExp): RegExpMatchArray | null;
    replace(searchValue: string | RegExp, replaceValue: string): string;
    search(regexp: string | RegExp): number;
    split(separator: string | RegExp, limit?: number): string[];
    substring(start: number, end?: number): string;
    trim(): string;
    trimStart(): string;
    trimEnd(): string;
    charAt(pos: number): string;
    charCodeAt(index: number): number;
    padStart(maxLength: number, fillString?: string): string;
    padEnd(maxLength: number, fillString?: string): string;
    repeat(count: number): string;
    toUpperCase(): string;
    toLowerCase(): string;
    /**
     * Decodes the bytes to a UTF-8 string on first access, then caches.
     * Subsequent calls return the cached string with zero cost.
     */
    private s;
}
