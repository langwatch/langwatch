/**
 * Full-page frame for the CLI authorize screen: the branded card every standalone page
 * stands on, wide enough for the permission list, with a way to sign out.
 */

import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import {
  Box,
  HStack,
  IconButton,
  Skeleton,
  SkeletonText,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { LogOut } from "lucide-react";
import type React from "react";

import { useApiKeyHost } from "../../model/api-key-host.ts";

/** What the card shows while the session answer is still arriving. */
function CliAuthSkeleton(): React.ReactElement {
  return (
    <VStack gap={6} align="stretch">
      <VStack gap={2} align="stretch">
        <Skeleton loading h="40px" borderRadius="lg" variant="shine" />
        <SkeletonText loading noOfLines={1} gap={2} variant="shine" />
        <HStack gap={3} align="center">
          <Skeleton loading boxSize="20px" borderRadius="xs" variant="shine" />
          <SkeletonText loading noOfLines={1} w="65%" variant="shine" />
        </HStack>
      </VStack>
      <HStack justify="space-between" w="full">
        <Box />
        <HStack gap={3}>
          <Skeleton loading h="40px" w="80px" borderRadius="lg" variant="shine" />
        </HStack>
      </HStack>
    </VStack>
  );
}

export function CliAuthContainer({
  children,
  title,
  subTitle,
  loading,
}: React.PropsWithChildren<{
  title: string;
  subTitle?: string;
  loading?: boolean;
}>): React.ReactElement {
  const host = useApiKeyHost();
  return (
    <BrandedCardPage>
      <Box position="fixed" top={3} right={3} zIndex={99}>
        <Tooltip content="Sign out">
          <IconButton
            variant="ghost"
            size="sm"
            borderRadius="full"
            aria-label="Sign out"
            color="fg.subtle"
            _hover={{ bg: "bg.muted", color: "fg" }}
            onClick={() => host.signOut()}
          >
            <LogOut size={16} />
          </IconButton>
        </Tooltip>
      </Box>
      <BrandedCard title={title} intro={subTitle} size="wide">
        {loading ? <CliAuthSkeleton /> : children}
      </BrandedCard>
    </BrandedCardPage>
  );
}
