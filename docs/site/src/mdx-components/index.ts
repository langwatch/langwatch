import { Accordion, AccordionGroup } from "./accordion.tsx";
import { Card, CardGroup } from "./cards.tsx";
import { Check, Info, Note, Tip, Warning } from "./callouts.tsx";
import { CodeGroup, CodeGroupItem } from "./code-group.tsx";
import { DocsCodeBlock } from "../code/code-block.tsx";
import { Expandable, ParamField, ResponseField } from "./fields.tsx";
import { Frame } from "./frame.tsx";
import { Icon } from "./icon.tsx";
import { DocsLink } from "./link.tsx";
import { DocsIframe, DocsImage, DocsVideo } from "./media.tsx";
import { DocsInlineCode, DocsTable, makeHeading } from "./prose.tsx";
import { Step, Steps } from "./steps.tsx";
import { Tab, Tabs } from "./tabs.tsx";
import { Tooltip } from "./tooltip.tsx";

export const mdxComponents = {
  Accordion,
  AccordionGroup,
  Card,
  CardGroup,
  Check,
  CodeGroup,
  CodeGroupItem,
  Expandable,
  Frame,
  Icon,
  Info,
  Note,
  ParamField,
  ResponseField,
  Step,
  Steps,
  Tab,
  Tabs,
  Tip,
  Tooltip,
  Warning,
  a: DocsLink,
  code: DocsInlineCode,
  h1: makeHeading({ level: 1 }),
  h2: makeHeading({ level: 2 }),
  h3: makeHeading({ level: 3 }),
  h4: makeHeading({ level: 4 }),
  h5: makeHeading({ level: 5 }),
  h6: makeHeading({ level: 6 }),
  DocsIframe,
  DocsImg: DocsImage,
  DocsVideo,
  iframe: DocsIframe,
  img: DocsImage,
  pre: DocsCodeBlock,
  table: DocsTable,
  video: DocsVideo,
};
