import { Badge, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Copy, MoreVertical, Server } from "lucide-react";
import { useEffect, useState } from "react";

import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import { UserAvatar } from "~/components/UserAvatar";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

/**
 * What a row shows of the key itself: a shortened, unmistakably truncated form
 * set as code, with the value beside it.
 *
 * This is what people actually match against — the question a credentials table
 * gets asked is "which of these is the one in my environment file", and the
 * answer is these few characters. So it sits on its own inset ground rather
 * than reading as another line of muted prose, and it can be lifted out.
 *
 * `display` and `copyValue` are separate on purpose. Most rows show and copy
 * only the head of the key; the legacy project key, which the product hands out
 * in full elsewhere, shows a masked form and copies the real thing. Because the
 * two look alike, `copyLabel` and `copiedTitle` are required and must say which
 * one this is: anyone who reads "copied" on a credentials page and assumes they
 * hold the secret has been misled by the interface.
 */
export function ApiKeyCopyField({
  display,
  copyValue,
  copyLabel,
  copiedTitle,
}: {
  /** The shortened form on screen. Never a whole secret. */
  display: string;
  /** What lands on the clipboard. */
  copyValue: string;
  /** Names exactly what is copied, for the button's accessible label. */
  copyLabel: string;
  /** The confirmation, naming the same thing again. */
  copiedTitle: string;
}) {
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => {
    if (!justCopied) return;
    const timer = setTimeout(() => setJustCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [justCopied]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyValue);
    setJustCopied(true);
    toaster.create({
      title: copiedTitle,
      type: "success",
      duration: 2000,
    });
  };

  return (
    <HStack
      gap={0}
      alignSelf="start"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="sm"
      background="bg.subtle"
      paddingLeft={2}
      maxWidth="full"
    >
      <Text
        fontFamily="mono"
        fontSize="xs"
        color="fg.muted"
        truncate
        minWidth={0}
      >
        {display}
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        color="fg.muted"
        aria-label={copyLabel}
        onClick={handleCopy}
      >
        {justCopied ? (
          <Check size={12} aria-hidden />
        ) : (
          <Copy size={12} aria-hidden />
        )}
      </Button>
    </HStack>
  );
}

const ACCESS_LEVELS: Record<
  string,
  { label: string; colorPalette: string; help: string }
> = {
  all: {
    label: "Full access",
    // Breadth is the thing worth noticing on a credentials page, so the widest
    // grant is the one carrying colour. Read only and Restricted stay quiet.
    colorPalette: "orange",
    help: "Everything this key's scopes allow.",
  },
  readonly: {
    label: "Read only",
    colorPalette: "blue",
    help: "Reads only. This key cannot change anything.",
  },
  restricted: {
    label: "Restricted",
    colorPalette: "gray",
    help: "Only the permissions picked for this key.",
  },
};

/**
 * What a key is allowed to do, as its own word for each of the three modes the
 * model has. Collapsing read only into restricted made two different keys read
 * the same, which is the one thing this column exists to prevent.
 */
export function ApiKeyAccessBadge({
  permissionMode,
}: {
  permissionMode: string;
}) {
  const level = ACCESS_LEVELS[permissionMode] ?? ACCESS_LEVELS.restricted!;
  return (
    <Tooltip content={level.help}>
      <Badge size="sm" variant="subtle" colorPalette={level.colorPalette}>
        {level.label}
      </Badge>
    </Tooltip>
  );
}

/**
 * Who holds a key. A key with no owner is a service key, and says so — the
 * alternative is a column that renders blank on every service row and leaves
 * the reader to guess whether that is a missing name or a missing person.
 */
export function ApiKeyOwnerCell({
  ownerName,
  ownerEmail,
}: {
  ownerName: string | null;
  ownerEmail: string | null;
}) {
  const name = ownerName ?? ownerEmail;

  if (!name) {
    return (
      <HStack gap={2} color="fg.muted">
        <Server size={14} aria-hidden />
        <Text fontSize="sm">Service key</Text>
      </HStack>
    );
  }

  return (
    <HStack gap={2} minWidth={0}>
      <UserAvatar size="2xs" name={name} />
      <Tooltip content={ownerEmail ?? name}>
        <Text fontSize="sm" truncate minWidth={0}>
          {name}
        </Text>
      </Tooltip>
    </HStack>
  );
}

/** When a key last authenticated a request, or that it never has. */
export function ApiKeyLastUsedCell({
  lastUsedAt,
}: {
  lastUsedAt: Date | string | null;
}) {
  if (!lastUsedAt) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Never used
      </Text>
    );
  }

  const used = new Date(lastUsedAt);
  return (
    <Tooltip content={used.toISOString()}>
      <Text
        fontSize="sm"
        cursor="help"
        tabIndex={0}
        aria-label={`Last used at ${used.toISOString()}`}
      >
        {formatTimeAgo(used.getTime())}
      </Text>
    </Tooltip>
  );
}

/** How many scope chips a row shows before the rest become a count. */
const VISIBLE_SCOPE_CHIPS = 2;

/**
 * Where a key reaches.
 *
 * A key can be bound to a dozen projects, and a dozen chips in a table cell is
 * a wall that reflows the row and is read by nobody. Two chips name the reach,
 * and the remainder becomes one count that names the rest on hover.
 */
export function ApiKeyScopeCell({
  scopes,
}: {
  scopes: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
    name?: string;
  }>;
}) {
  if (scopes.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No scopes
      </Text>
    );
  }

  const visible = scopes.slice(0, VISIBLE_SCOPE_CHIPS);
  const hidden = scopes.slice(VISIBLE_SCOPE_CHIPS);

  return (
    <HStack gap={1} wrap="wrap">
      <ProviderScopeChips size="xs" scopes={visible} />
      {hidden.length > 0 && (
        <Tooltip
          content={hidden
            .map((scope) => scope.name ?? scope.scopeId)
            .join(", ")}
        >
          <Badge size="xs" variant="subtle" colorPalette="gray" tabIndex={0}>
            {`+${hidden.length} more`}
          </Badge>
        </Tooltip>
      )}
    </HStack>
  );
}

/**
 * The key's name, what it is for, and the head of the secret.
 *
 * A status marker rides the name only when there is something to say. Every row
 * reading "Active" in the same green is a column of identical chips that hides
 * the one row that is not, so the ordinary state is silence and expiry is the
 * only thing that speaks.
 */
export function ApiKeyNameCell({
  name,
  description,
  secret,
  isExpired,
  icon,
}: {
  name: string;
  description: string | null;
  /** Everything {@link ApiKeyCopyField} needs to show and copy this key. */
  secret: {
    display: string;
    copyValue: string;
    copyLabel: string;
    copiedTitle: string;
  };
  isExpired: boolean;
  icon: React.ReactNode;
}) {
  return (
    <HStack align="start" gap={2}>
      <Box paddingTop={1} color="fg.muted">
        {icon}
      </Box>
      <VStack align="start" gap={1} minWidth={0}>
        <HStack gap={2}>
          <Text fontWeight="semibold">{name}</Text>
          {isExpired && (
            <Badge size="sm" variant="subtle" colorPalette="red">
              Expired
            </Badge>
          )}
        </HStack>
        {description && (
          <Text fontSize="xs" color="fg.muted">
            {description}
          </Text>
        )}
        <ApiKeyCopyField {...secret} />
      </VStack>
    </HStack>
  );
}

/**
 * Every action a row offers, behind one trigger, per
 * dev/docs/best_practices/row-actions-overflow-menu.md. A row whose viewer can
 * do nothing renders no trigger rather than an empty menu.
 */
export function ApiKeyRowActions({
  keyName,
  onEdit,
  onRevoke,
}: {
  keyName: string;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${keyName}`}>
          <MoreVertical size={14} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </Menu.Item>
        <Menu.Item
          value="revoke"
          color="red.500"
          onClick={(event) => {
            event.stopPropagation();
            onRevoke();
          }}
        >
          Revoke
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
