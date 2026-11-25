/** What an install may send as its instance id: a UUID fits, a payload does not. */
const INSTANCE_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

export function isInstanceIdShape(value: string): boolean {
  return INSTANCE_ID_SHAPE.test(value);
}
