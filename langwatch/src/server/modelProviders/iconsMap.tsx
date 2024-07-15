import { Anthropic } from "../../components/icons/Anthropic";
import { Azure } from "../../components/icons/Azure";
import { Cloudflare } from "../../components/icons/Cloudflare";
import { Google } from "../../components/icons/Google";
import { Groq } from "../../components/icons/Groq";
import { Meta } from "../../components/icons/Meta";
import { Mistral } from "../../components/icons/Mistral";
import { OpenAI } from "../../components/icons/OpenAI";
import { type modelProviders } from "./registry";

export const modelProviderIcons: Record<
  keyof typeof modelProviders,
  React.ReactNode
> = {
  openai: <OpenAI />,
  azure: <Azure />,
  anthropic: <Anthropic />,
  groq: <Groq />,
  vertex_ai: <Google />,
  cloudflare: <Cloudflare />,
};

export const vendorIcons: Record<string, React.ReactNode> = {
  azure: <Azure />,
  openai: <OpenAI />,
  meta: <Meta />,
  mistral: <Mistral />,
  anthropic: <Anthropic />,
  google: <Google />,
  cloudflare: <Cloudflare />,
};
