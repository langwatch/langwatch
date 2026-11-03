/** A code sample as the code components render it and the playground builds it. */
export type CodeSource = {
  lang: string;
  title: string;
  code: string;
  lines: string[];
  highlight: number[];
  numbered: boolean;
};
