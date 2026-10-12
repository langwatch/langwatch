import { DocsCodeBlock } from "../../code/ui/code-block.tsx";
import { Accordion, AccordionGroup } from "./accordion.tsx";
import { AgentQuickStart } from "./agent-quick-start.tsx";
import { Check, Info, Note, Tip, Warning } from "./callouts.tsx";
import { Card, CardGroup } from "./cards.tsx";
import { CodeGroup, CodeGroupItem } from "./code-group.tsx";
import { Expandable, ParamField, ResponseField } from "./fields.tsx";
import { Frame } from "./frame.tsx";
import { Icon } from "./icon.tsx";
import { LegacyContent } from "./legacy-content.tsx";
import { DocsIframe, DocsImage, DocsSource, DocsVideo } from "./media.tsx";
import {
  DocsAnchor,
  DocsInlineCode,
  DocsTable,
  DocsTableCell,
  makeHeading,
  DocsLink,
} from "./prose.tsx";
import { SkillCard } from "./skill-card.tsx";
import { Step, Steps } from "./steps.tsx";
import { Tab, Tabs } from "./tabs.tsx";
import { Tooltip } from "./tooltip.tsx";

export const mdxComponents = {
  AgentQuickStart,
  SkillCard,
  LegacyContent,
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
  DocsAnchor,
  DocsInlineCode,
  code: DocsInlineCode,
  h1: makeHeading({ level: 1 }),
  h2: makeHeading({ level: 2 }),
  h3: makeHeading({ level: 3 }),
  h4: makeHeading({ level: 4 }),
  h5: makeHeading({ level: 5 }),
  h6: makeHeading({ level: 6 }),
  DocsIframe,
  DocsImg: DocsImage,
  DocsSource,
  DocsVideo,
  iframe: DocsIframe,
  img: DocsImage,
  pre: DocsCodeBlock,
  table: DocsTable,
  td: DocsTableCell,
  video: DocsVideo,
};
