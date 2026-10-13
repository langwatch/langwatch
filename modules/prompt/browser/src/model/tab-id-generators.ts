import { generate } from "@langwatch/ksuid";

export function createTabId() {
  return generate("prompttab").toString();
}

export function createWindowId() {
  return generate("promptwindow").toString();
}
