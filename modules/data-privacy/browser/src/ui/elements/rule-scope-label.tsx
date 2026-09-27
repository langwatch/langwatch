import { Badge, HStack, Text } from "@chakra-ui/react";
import type { DataPrivacyRule } from "@langwatch/data-privacy-contract";
import { Folder, UserLock } from "lucide-react";

import { SCOPE_ICON } from "../../model/data-privacy-labels.ts";

/** A rule's scope: its icon, name, scope type and whether it is personal-only. */
export function RuleScopeLabel({ rule, fontSize }: { rule: DataPrivacyRule; fontSize?: string }) {
  const Icon = rule.personalOnly ? UserLock : (SCOPE_ICON[rule.scopeType] ?? Folder);
  return (
    <HStack gap={2}>
      <Icon size={14} />
      <Text fontSize={fontSize}>{rule.name}</Text>
      <Badge size="sm" colorPalette="gray">
        {rule.scopeType.toLowerCase()}
      </Badge>
      {rule.personalOnly && (
        <Badge size="sm" colorPalette="purple">
          personal
        </Badge>
      )}
    </HStack>
  );
}
