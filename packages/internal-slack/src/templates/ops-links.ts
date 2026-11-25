const opsUrl = ({ appUrl, page, id }: { appUrl: string; page: string; id: string }): string =>
  `${appUrl.replace(/\/+$/, "")}/ops/${page}?q=${encodeURIComponent(id)}`;

export const userInOps = ({ appUrl, userId }: { appUrl: string; userId: string }) => ({
  label: "User in ops",
  url: opsUrl({ appUrl, page: "users", id: userId }),
});

export const organizationInOps = ({
  appUrl,
  organizationId,
  primary = true,
}: {
  appUrl: string;
  organizationId: string;
  primary?: boolean;
}) => ({
  label: "Organisation in ops",
  url: opsUrl({ appUrl, page: "organizations", id: organizationId }),
  primary,
});
