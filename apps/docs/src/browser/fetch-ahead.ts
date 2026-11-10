/** Whether a page may be fetched ahead of a click: never offline or for a reader saving data. */
export function mayFetchAhead() {
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  return navigator.onLine && !saveData;
}
