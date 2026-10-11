import { FullLogo } from "@langwatch/design-system/full-logo";
import { GitHubIcon } from "@langwatch/design-system/icons";
import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight } from "lucide-react";

import { site } from "../lib/nav-model.ts";

const FOOTER_GROUPS = [
  {
    title: "Build with LangWatch",
    links: [
      { label: "Quick start", href: "/integration/quick-start" },
      { label: "API reference", href: "/api-reference/introduction" },
      { label: "Self hosting", href: "/self-hosting/overview" },
      { label: "Docs for agents", href: "/llms.txt" },
    ],
  },
  {
    title: "Make it better",
    links: [
      { label: "Contribute on GitHub", href: `${site.github}/blob/main/CONTRIBUTING.md` },
      { label: "Report an issue", href: `${site.github}/issues` },
      { label: "Join the community", href: "https://discord.gg/kT4PhDS2gH" },
      { label: "Get support", href: "/support" },
    ],
  },
];

export function SiteFooter() {
  return (
    <Box
      as="footer"
      className="docs-site-footer"
      position="relative"
      zIndex="1"
      maxWidth="1360px"
      marginX="auto"
      padding={{ base: "7", lg: "10" }}
      marginTop="8"
    >
      <Box
        display="grid"
        gridTemplateColumns={{ base: "1fr", md: "1.4fr 1fr 1fr" }}
        gap={{ base: "8", md: "12" }}
        paddingBottom="8"
      >
        <Box>
          <Link href="https://langwatch.ai" aria-label="LangWatch website" display="inline-flex">
            <FullLogo width={144} height={35.3} />
          </Link>
          <Text maxWidth="32ch" marginTop="4" fontSize="15px" lineHeight="26px" color="docs.body">
            Built for the people building AI.
            <br />
            Open source, and better together.
          </Text>
          <Link
            href={site.github}
            gap="2"
            fontSize="14px"
            fontWeight="600"
            marginTop="4"
            color="fg"
          >
            <GitHubIcon size={17} /> Star LangWatch on GitHub <ArrowUpRight size={14} />
          </Link>
        </Box>
        {FOOTER_GROUPS.map((group) => (
          <Box key={group.title}>
            <Text fontSize="14px" fontWeight="600" color="fg" marginBottom="4">
              {group.title}
            </Text>
            <Flex
              as="nav"
              aria-label={group.title}
              direction="column"
              alignItems="flex-start"
              gap="2"
            >
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  fontSize="14px"
                  minHeight="32px"
                  color="docs.body"
                >
                  {link.label}
                </Link>
              ))}
            </Flex>
          </Box>
        ))}
      </Box>
      <Flex
        borderTopWidth="1px"
        borderColor="border"
        paddingTop="5"
        gap="4"
        justifyContent="space-between"
        wrap="wrap"
        fontSize="13px"
        color="docs.lede"
      >
        <Text margin="0">LangWatch B.V. · Built in Amsterdam.</Text>
        <Link href={`${site.github}/blob/main/LICENSE.md`} color="inherit">
          Open core. Apache 2.0 + Enterprise.
        </Link>
      </Flex>
    </Box>
  );
}
