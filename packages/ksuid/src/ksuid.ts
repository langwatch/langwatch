import { encode, decode } from "./base62.ts";
import { checkInstance, Instance } from "./instance.ts";
import type { KsuidComponents, KsuidLayout, ParsedKsuid } from "./types.ts";
import { checkPrefix, checkUint, DECODED_LEN, ENCODED_LEN, KSUID_REGEX } from "./validation.ts";

/**
 * A K-Sortable Unique IDentifier (KSUID): globally unique, k-sortable, with an
 * environment prefix, resource type, 48-bit Unix timestamp, 8-byte instance
 * identifier and 32-bit sequence number.
 */
export class Ksuid {
  private readonly _environment: string;
  private readonly _resource: string;
  private readonly _timestamp: number;
  private readonly _instance: Instance;
  private readonly _sequenceId: number;
  private readonly _layout: KsuidLayout;
  private _string?: string;

  /**
   * Creates a new KSUID instance
   * @param environment - The environment (e.g., 'prod', 'dev', 'staging')
   * @param resource - The resource type (e.g., 'user', 'order', 'product')
   * @param timestamp - Unix timestamp in seconds (48-bit)
   * @param instance - The instance identifier
   * @param sequenceId - Sequence number for collision avoidance
   * @param layout - Byte layout, "v2" unless the id is derived from stored inputs
   * @throws {ValidationError} If any parameter is invalid
   */
  constructor({
    environment,
    resource,
    timestamp,
    instance,
    sequenceId,
    layout = "v2",
  }: KsuidComponents) {
    checkPrefix("environment", environment);
    checkPrefix("resource", resource);
    checkUint("timestamp", timestamp, layout === "v1-legacy" ? 4 : 6);
    checkInstance("instance", instance);
    checkUint("sequenceId", sequenceId, 4);

    this._environment = environment;
    this._resource = resource;
    this._timestamp = timestamp;
    this._instance = instance;
    this._sequenceId = sequenceId;
    this._layout = layout;
  }

  /** The environment (e.g., 'prod', 'dev', 'staging') */
  get environment(): string {
    return this._environment;
  }

  /** The resource type (e.g., 'user', 'order', 'product') */
  get resource(): string {
    return this._resource;
  }

  /** Unix timestamp in seconds when the KSUID was created */
  get timestamp(): number {
    return this._timestamp;
  }

  /** The instance identifier */
  get instance(): Instance {
    return this._instance;
  }

  /** Sequence number for collision avoidance */
  get sequenceId(): number {
    return this._sequenceId;
  }

  /** The byte layout the string form is written in */
  get layout(): KsuidLayout {
    return this._layout;
  }

  /** The same identifier written in another layout; the two strings differ only in bytes 2-3 */
  withLayout(layout: KsuidLayout): Ksuid {
    if (layout === this._layout) return this;
    return new Ksuid({
      environment: this._environment,
      resource: this._resource,
      timestamp: this._timestamp,
      instance: this._instance,
      sequenceId: this._sequenceId,
      layout,
    });
  }

  /** JavaScript Date object representing the creation time */
  get date(): Date {
    return new Date(this._timestamp * 1000);
  }

  /**
   * Converts the KSUID to its string representation
   * @returns The KSUID as a string (e.g., 'user_0001q4bXFY4siSyoTTkaIIabGiMZo')
   */
  toString(): string {
    // Cache the string since it's immutable
    if (this._string) {
      return this._string;
    }

    const env = this._environment === "prod" ? "" : `${this._environment}_`;
    const prefix = `${env}${this._resource}_`;

    const decoded = new Uint8Array(DECODED_LEN);

    // 48-bit timestamp in bytes 2-7; bytes 0-1 stay zero. Shift counts in JS are taken mod 32,
    // so the high 16 bits come from division, never from `>> 32`.
    const low = this._timestamp % 2 ** 32;
    const high =
      this._layout === "v1-legacy" ? low & 0xffff : Math.floor(this._timestamp / 2 ** 32);
    decoded[2] = (high >>> 8) & 0xff;
    decoded[3] = high & 0xff;
    decoded[4] = (low >>> 24) & 0xff;
    decoded[5] = (low >>> 16) & 0xff;
    decoded[6] = (low >>> 8) & 0xff;
    decoded[7] = low & 0xff;

    // Write instance (9 bytes)
    const instanceBuffer = this._instance.toBuffer();
    decoded.set(instanceBuffer, 8);

    // Write sequence ID (4 bytes)
    decoded[17] = (this._sequenceId >>> 24) & 0xff;
    decoded[18] = (this._sequenceId >>> 16) & 0xff;
    decoded[19] = (this._sequenceId >>> 8) & 0xff;
    decoded[20] = this._sequenceId & 0xff;

    const encoded = encode(decoded);
    const padded = encoded.padStart(ENCODED_LEN, "0");

    this._string = prefix + padded;
    return this._string;
  }

  /**
   * @param input - The KSUID string to parse
   * @returns A new Ksuid instance
   * @throws {Error} If the input is invalid or malformed
   */
  static parse(input: string): Ksuid {
    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }

    if (!input.length) {
      throw new Error("Input must not be empty");
    }

    const { environment, resource, encoded } = splitPrefixId(input);

    const decoded = decode(encoded);
    const fullDecoded = new Uint8Array(DECODED_LEN);

    // Copy the last DECODED_LEN bytes
    const start = Math.max(0, decoded.length - DECODED_LEN);
    fullDecoded.set(decoded.slice(start), DECODED_LEN - decoded.length + start);

    // Check if timestamp is too large
    if (fullDecoded[0] !== 0 || fullDecoded[1] !== 0) {
      throw new Error("Timestamp greater than 8921556-12-07T10:44:16Z");
    }

    // fullDecoded is a fixed-length (DECODED_LEN) Uint8Array filled in full
    // above, so every index read here is in-bounds by construction.
    const high = (fullDecoded[2]! << 8) | fullDecoded[3]!;
    const low = readUint32(fullDecoded, 4);
    // A v1-legacy id repeats the low 16 bits in bytes 2-3; a v2 id has zero there until 2106.
    // Both write the same bytes when the low 16 bits are zero, so that case reads as v2.
    const layout: KsuidLayout = high !== 0 && high === (low & 0xffff) ? "v1-legacy" : "v2";
    const timestamp = layout === "v1-legacy" ? low : high * 2 ** 32 + low;

    const instance = Instance.fromBuffer(fullDecoded.slice(8, 17));

    const sequenceId = readUint32(fullDecoded, 17);

    return new Ksuid({ environment, resource, timestamp, instance, sequenceId, layout });
  }

  /**
   * @param other - The KSUID to compare with
   * @returns True if both KSUIDs are equal, false otherwise
   */
  equals(other: Ksuid): boolean {
    if (!(other instanceof Ksuid)) {
      return false;
    }

    return this.toString() === other.toString();
  }

  /**
   * @returns An object containing all KSUID components
   */
  toJSON(): object {
    return {
      environment: this._environment,
      resource: this._resource,
      timestamp: this._timestamp,
      date: this.date.toISOString(),
      instance: {
        scheme: this._instance.scheme,
        identifier: Array.from(this._instance.identifier),
      },
      sequenceId: this._sequenceId,
      string: this.toString(),
    };
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function splitPrefixId(input: string): ParsedKsuid {
  const parsed = KSUID_REGEX.exec(input);

  if (!parsed) {
    throw new Error("ID is invalid");
  }

  const [, environment, resource, encoded] = parsed;

  // `resource` and `encoded` are non-optional capture groups in KSUID_REGEX
  // (only `environment` is wrapped in `(?:...)?`), so a successful match
  // always fills them; this narrows the type rather than handling a real case.
  if (resource === undefined || encoded === undefined) {
    throw new Error("ID is invalid");
  }

  if (environment === "prod") {
    throw new Error("Production environment is implied");
  }

  return {
    environment: environment || "prod",
    resource,
    encoded,
  };
}
