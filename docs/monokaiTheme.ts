// @flow
// Converted automatically using prism-react-renderer/tools/themeFromVsCode

import { PrismTheme, themes } from "prism-react-renderer";

export const monkaiTheme: PrismTheme = {
  ...themes.vsDark,
  plain: {
    color: "#f8f8f2",
    backgroundColor: "#272822",
  },
  styles: [
    ...themes.vsDark.styles,
    {
      types: ["variable"],
      style: {
        color: "rgb(248, 248, 242)",
      },
    },
    {
      types: ["comment"],
      style: {
        color: "rgb(136, 132, 111)",
      },
    },
    {
      types: ["string", "changed"],
      style: {
        color: "rgb(230, 219, 116)",
      },
    },
    {
      types: ["punctuation", "tag", "deleted"],
      style: {
        color: "rgb(249, 38, 114)",
      },
    },
    {
      types: ["number", "builtin"],
      style: {
        color: "rgb(174, 129, 255)",
      },
    },
    {
      types: ["function", "attr-name", "inserted"],
      style: {
        color: "rgb(166, 226, 46)",
      },
    },
  ],
};
