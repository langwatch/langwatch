import { createHash } from "node:crypto";

import { docsUrl } from "../../../lib/site-path.ts";

/** A skill the docs publish for agents: its name, one-line description and SKILL.md bytes. */
export type AgentSkill = { name: string; description: string; contents: string };

const SKILLS_DIRECTORY = ".well-known/agent-skills";

/** Output path of a skill's published SKILL.md. */
export function skillFile({ name }: { name: string }) {
  return `${SKILLS_DIRECTORY}/${name}/SKILL.md`;
}

/** Absolute docs URL of a skill's published SKILL.md. */
export function skillUrl({ name }: { name: string }) {
  return docsUrl({ path: `/${skillFile({ name })}` });
}

/** The skills index agents fetch to discover installable skills. */
export function agentSkillsIndex({ skills }: { skills: AgentSkill[] }) {
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: skills.map((skill) => ({
      name: skill.name,
      type: "skill-md",
      description: skill.description,
      url: skillUrl({ name: skill.name }),
      digest: `sha256:${createHash("sha256").update(skill.contents).digest("hex")}`,
    })),
  };
}

/** The agent card describing LangWatch and its skills. */
export function agentCard({ skills, description }: { skills: AgentSkill[]; description: string }) {
  const url = docsUrl({ path: "/" });
  return {
    name: "LangWatch",
    description,
    url,
    version: "1.0.0",
    protocolVersion: "0.3",
    preferredTransport: "HTTP+JSON",
    supportedInterfaces: [{ url, protocolBinding: "HTTP+JSON", protocolVersion: "0.3" }],
    provider: { url, organization: "LangWatch" },
    documentationUrl: url,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: skills.map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      tags: [],
      url: skillUrl({ name: skill.name }),
    })),
  };
}
