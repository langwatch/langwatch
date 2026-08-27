declare module "lodash-es/debounce" {
  type Callable = (...args: never[]) => unknown;

  type DebounceOptions = {
    leading?: boolean;
    trailing?: boolean;
  };

  const debounce: <Callback extends Callable>(
    callback: Callback,
    wait?: number,
    options?: DebounceOptions,
  ) => Callback;

  export default debounce;
}
