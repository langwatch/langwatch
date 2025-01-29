import { Anthropic } from "../../components/icons/Anthropic";
import { AWS } from "../../components/icons/AWS";
import { Azure } from "../../components/icons/Azure";
import { Cloudflare } from "../../components/icons/Cloudflare";
import { Custom } from "../../components/icons/Custom";
import { DeepSeek } from "../../components/icons/DeepSeek";
import { Gemini } from "../../components/icons/Gemini";
import { GoogleCloud } from "../../components/icons/GoogleCloud";
import { Groq } from "../../components/icons/Groq";
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
  vertex_ai: <GoogleCloud />,
  gemini: <Gemini />,
  cloudflare: <Cloudflare />,
  bedrock: <AWS />,
  deepseek: <DeepSeek />,
  custom: <Custom />,
};
