/** "1 run", "2 runs", "1,200 items". */
export const plural = ({ count, noun }: { count: number; noun: string }): string =>
  `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
