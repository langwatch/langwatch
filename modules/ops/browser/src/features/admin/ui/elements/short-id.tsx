import { IdText } from "@langwatch/design-system/id-text";

/** An identifier cut in the middle, with a way to copy it whole. */
export function ShortId({ id }: { id: string }) {
  return <IdText value={id} label={`ID ${id}`} />;
}
