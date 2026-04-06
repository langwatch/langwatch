import { Menu } from "~/components/ui/menu";
import { Separator } from "@chakra-ui/react";
import { useRequiredSession } from "~/hooks/useRequiredSession";

type User = {
  name: string;
  impersonator?: {
    name: string;
  };
};

export const ImpersonationSwitchBackMenuItem = () => {
  const { data: session } = useRequiredSession();
  const user = session?.user as User | undefined;

  return user?.impersonator ? (
    <>
      <Menu.ItemGroup title={`Impersonating ${user.name}`}>
        <Menu.Item
          value="switch-back"
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            const response = await fetch("/api/admin/impersonate", {
              method: "DELETE",
            });
            if (response.ok) {
              window.location.href = "/admin#/user";
            }
          }}
        >
          Switch back to {user.impersonator.name}
        </Menu.Item>
      </Menu.ItemGroup>
      <Separator />
    </>
  ) : null;
};
