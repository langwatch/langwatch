import { IdText } from "@langwatch/design-system/id-text";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { AggregateProjectAvatar, ProjectAvatar } from "@langwatch/design-system/project-avatar";
import { KeyRound, Settings } from "lucide-react";
import type { ReactNode } from "react";

import { currentProjectLinks } from "../../model/current-project-links.ts";
import { NavigationLink } from "../elements/navigation-link.tsx";

/**
 * The top of the project switcher: the current project's name, its ID with a copy
 * button, and the way to its settings and keys. It holds no list option, so the
 * search field keeps the keyboard. Spec: specs/navigation/project-switcher-current-project.feature
 */
export function CurrentProjectHeader({
  projectId,
  projectName,
  isAggregate,
  canOpenSettings,
  onNavigate,
}: {
  projectId: string;
  projectName: string;
  isAggregate: boolean;
  canOpenSettings: boolean;
  onNavigate: () => void;
}) {
  const { settingsHref, apiKeysHref } = currentProjectLinks({
    projectId,
    isAggregate,
    canOpenSettings,
  });
  return (
    <VStack
      as="section"
      aria-label="Current project"
      align="stretch"
      gap={1.5}
      paddingX={3}
      paddingY={2.5}
      borderBottomWidth="1px"
      borderColor="border"
    >
      <HStack gap={2} minWidth={0}>
        {isAggregate ? (
          <AggregateProjectAvatar name={projectName} />
        ) : (
          <ProjectAvatar name={projectName} />
        )}
        <Text textStyle="bodySm" fontWeight="medium" truncate>
          {projectName}
        </Text>
      </HStack>
      <HStack gap={2} minWidth={0}>
        <Text textStyle="micro" color="fg.muted" flexShrink={0}>
          Project ID
        </Text>
        <IdText value={projectId} label="project ID" />
      </HStack>
      <HStack gap={3} flexWrap="wrap">
        {settingsHref && (
          <HeaderLink
            href={settingsHref}
            icon={<Settings size={12} aria-hidden />}
            onNavigate={onNavigate}
          >
            Project settings
          </HeaderLink>
        )}
        {apiKeysHref && (
          <HeaderLink
            href={apiKeysHref}
            icon={<KeyRound size={12} aria-hidden />}
            onNavigate={onNavigate}
          >
            API keys for this project
          </HeaderLink>
        )}
      </HStack>
    </VStack>
  );
}

function HeaderLink({
  href,
  icon,
  onNavigate,
  children,
}: {
  href: string;
  icon: ReactNode;
  onNavigate: () => void;
  children: string;
}) {
  return (
    <NavigationLink
      href={href}
      onClick={onNavigate}
      display="inline-flex"
      alignItems="center"
      gap={1}
      textStyle="bodySm"
      color="fg.muted"
      _hover={{ color: "fg", textDecoration: "underline" }}
    >
      {icon}
      <Box as="span">{children}</Box>
    </NavigationLink>
  );
}
