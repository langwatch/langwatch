import { Alert, Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";

/** One person who walked in, as the notice needs them. The address is not
 *  here — the domain is what admitted them and what an admin is reading. */
export interface AutomaticJoin {
  joinRequestId: string;
  name: string;
  domain: string;
  joinedAt: Date | null;
}

/**
 * Who joined without anybody approving (D12).
 *
 * The in-product half of telling the admins after the fact. Every automatic
 * join emails every admin the moment it happens; this is what an admin who
 * was not reading their inbox sees, in the same panel as the requests they
 * answer by hand.
 *
 * It names who joined and says WHAT admitted them, because that is the one
 * question a surprising member raises — and the answer, "your domain setting
 * let them in", is also the way to stop it happening again. Renders nothing
 * when nobody walked in, which is every organization that never turned
 * automatic joining on.
 */
export function AutomaticJoinsNotice({ joins }: { joins: AutomaticJoin[] }) {
  if (joins.length === 0) return null;

  return (
    <Alert.Root
      status="info"
      width="full"
      marginTop={4}
      data-testid="automatic-joins-notice"
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {joins.length === 1
            ? "Somebody joined automatically"
            : `${joins.length} colleagues joined automatically`}
        </Alert.Title>
        <Alert.Description>
          <VStack align="start" gap={2} paddingTop={1} width="full">
            <Text>
              Your domain setting admitted them with your organization&apos;s
              default role. Nobody approved these.
            </Text>
            {joins.map((join) => (
              <HStack key={join.joinRequestId} gap={2}>
                <RandomColorAvatar size="2xs" name={join.name} />
                <Text fontWeight="medium">{join.name}</Text>
                <Badge>{join.domain}</Badge>
                {join.joinedAt ? (
                  <Text color="fg.muted" fontSize="sm">
                    {formatDay(join.joinedAt)}
                  </Text>
                ) : null}
              </HStack>
            ))}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
