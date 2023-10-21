import { type Debugger } from "debug";

export const getDebugger = (namespace: string): Debugger => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires
  return require("debug")(namespace) as Debugger;
};
