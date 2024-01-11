export function toFixedWithoutRounding(
  number: number | undefined,
  decimalPlaces: number
) {
  if (!number) return undefined;

  const factor = Math.pow(10, decimalPlaces);
  return Math.floor(number * factor) / factor;
}
