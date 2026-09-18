/**
 * The blob Smithy type, in JS as Uint8Array and other representations
 * such as Buffer, string, or Readable(Stream) depending on circumstances.
 * @public
 */
export type BlobSchema = 0b0001_0101;
/**
 * @public
 */
export type StreamingBlobSchema = 0b0010_1010;
/**
 * @public
 */
export type BooleanSchema = 0b0000_0010;
/**
 * Includes string and enum Smithy types.
 * @public
 */
export type StringSchema = 0b0000_0000;
/**
 * Includes all numeric Smithy types except bigInteger and bigDecimal.
 * byte, short, integer, long, float, double, intEnum.
 *
 * @public
 */
export type NumericSchema = 0b0000_0001;
/**
 * @public
 */
export type BigIntegerSchema = 0b0001_0001;
/**
 * @public
 */
export type BigDecimalSchema = 0b0001_0011;
/**
 * @public
 */
export type DocumentSchema = 0b0000_1111;
/**
 * Smithy type timestamp, in JS as native Date object.
 * @public
 */
export type TimestampDefaultSchema = 0b0000_0100;
/**
 * @public
 */
export type TimestampDateTimeSchema = 0b0000_0101;
/**
 * @public
 */
export type TimestampHttpDateSchema = 0b0000_0110;
/**
 * @public
 */
export type TimestampEpochSecondsSchema = 0b0000_0111;
/**
 * Additional bit indicating the type is a list.
 * @public
 */
export type ListSchemaModifier = 0b0100_0000;
/**
 * Additional bit indicating the type is a map.
 * @public
 */
export type MapSchemaModifier = 0b1000_0000;
