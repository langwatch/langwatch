import type { ReactNode } from "react";

/** The complete application shell supplied by browser composition. */
export abstract class UiShell {
  abstract prepare(): void;

  abstract render(): ReactNode;
}
