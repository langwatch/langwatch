import type { ComponentProps } from "react";

import { useUserAvatarUrl } from "../../behavior/user/use-user-avatar-url.ts";
import { IdentityRow } from "../elements/identity-row.tsx";

/** An identity row for a person: a stored photo is resolved to its signed URL here. */
export function PersonIdentityRow({ image, ...rowProps }: ComponentProps<typeof IdentityRow>) {
  return <IdentityRow image={useUserAvatarUrl(image)} {...rowProps} />;
}
