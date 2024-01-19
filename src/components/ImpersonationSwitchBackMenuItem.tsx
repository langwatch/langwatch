import {
  MenuGroup,
  MenuItem,
  MenuDivider
} from "../../langwatch/langwatch/node_modules/@chakra-ui/react";
import { useRequiredSession } from "../../langwatch/langwatch/src/hooks/useRequiredSession";

export const ImpersonationSwitchBackMenuItem = () => {
  const { data: session } = useRequiredSession();

  return session && (session.user as any).impersonator ? (
    <>
      <MenuGroup title={`Impersonating ${session.user.name}`}>
        <MenuItem
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            const response = await fetch(
              "/api/admin/impersonate",
              { method: "DELETE" }
            );
            if (response.ok) {
              window.location.href = "/admin#/user";
            }
          }}
        >
          Switch back to {(session.user as any).impersonator.name}
        </MenuItem>
      </MenuGroup>
      <MenuDivider />
    </>
  ) : null;
}