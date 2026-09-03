import { HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Fragment } from "react";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import type { AnnotationUser } from "../../model/annotation-row";

export function AnnotationAvatarGroup({
  createdByUser,
  annotations,
  renderAvatar,
}: {
  createdByUser: AnnotationUser | null;
  annotations: AnnotationWithUser[];
  renderAvatar: (user: AnnotationUser) => ReactNode;
}) {
  const users = new Map<string, AnnotationUser>();
  if (createdByUser) {
    users.set(createdByUser.id, createdByUser);
  }

  for (const annotation of annotations) {
    if (annotation.user) {
      users.set(annotation.user.id, annotation.user);
    }
  }

  return (
    <HStack gap={2}>
      {[...users.values()].map((user) => (
        <Fragment key={user.id}>{renderAvatar(user)}</Fragment>
      ))}
    </HStack>
  );
}
