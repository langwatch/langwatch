declare module "lodash-es/debounce" {
  type DebounceOptions = {
    leading?: boolean;
    trailing?: boolean;
  };

  const debounce: <T extends (...args: any[]) => unknown>(
    callback: T,
    wait?: number,
    options?: DebounceOptions,
  ) => T;

  export default debounce;
}
