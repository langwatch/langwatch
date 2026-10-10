import { Button, Center, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { AccessState } from "./access-state.tsx";

export type RestrictedAccessProps = {
  /** The permission the viewer is missing, as `resource:action`. */
  permission?: string;
  /** What the viewer cannot open, as a noun phrase: "this page", "directory provisioning". */
  area?: string;
  compact?: boolean;
  detail?: string;
  description?: string;
  onBack?: () => void;
  /** Who is asking, written into the copied request when known. */
  requesterName?: string;
  "data-testid"?: string;
};

/** `datasets:view` reads "view datasets"; `model-providers:manage`, "manage model providers". */
export function describePermission(permission: string): string {
  const [resource = permission, action] = permission.split(":");
  const subject = resource
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
  const readableSubject = resource === "sso" ? "single sign-on" : subject;
  return action ? `${action} ${readableSubject}` : readableSubject;
}

/** The words an admin needs to grant the access: who, what, and where. */
export function accessRequestText({
  permission,
  area,
  requesterName,
  link,
}: {
  permission?: string;
  area: string;
  requesterName?: string;
  link: string;
}): string {
  return [
    `${requesterName ?? "I"} need${requesterName ? "s" : ""} access to ${area}.`,
    ...(permission ? [`Missing permission: ${permission}`] : []),
    `Page: ${link}`,
  ].join("\n");
}

/** In place of a page the viewer's role cannot open: what is missing, and who can grant it. */
export function RestrictedAccess({
  permission,
  area = "this page",
  requesterName,
  compact = false,
  detail,
  description,
  onBack,
  "data-testid": testId,
}: RestrictedAccessProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(
        accessRequestText({ permission, area, requesterName, link: window.location.href }),
      );
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <Center
      minHeight={compact ? void 0 : "50vh"}
      width="full"
      padding={compact ? 0 : { base: 4, md: 8 }}
    >
      <AccessState
        kind="permission"
        title={`You don't have access to ${area}`}
        description={
          description ??
          (permission
            ? `Your role doesn't let you ${describePermission(permission)}. Ask an organization admin to give you access.`
            : "Your role doesn't include this action. Ask an organization admin to give you access.")
        }
        compact={compact}
        data-testid={testId}
        actions={
          <>
            <Button size="sm" colorPalette="orange" onClick={() => void copyRequest()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Request copied" : "Copy access request"}
            </Button>
            {(!compact || onBack) && (
              <Button size="sm" variant="outline" onClick={onBack ?? (() => window.history.back())}>
                Go back
              </Button>
            )}
          </>
        }
      >
        {detail && (
          <Text color="fg.muted" fontSize="sm">
            {detail}
          </Text>
        )}
        {permission && (
          <Text fontSize="xs" color="fg.subtle" overflowWrap="anywhere">
            Missing permission: {permission}
          </Text>
        )}
        {copyFailed && (
          <Text role="alert" fontSize="sm" color="fg.muted">
            Couldn't copy the request. Send this page's address
            {permission ? ` and the permission ${permission}` : ""} to an organization admin.
          </Text>
        )}
        {copied && (
          <Text as="output" fontSize="sm" color="fg.muted">
            Send the copied request to an organization admin.
          </Text>
        )}
      </AccessState>
    </Center>
  );
}
