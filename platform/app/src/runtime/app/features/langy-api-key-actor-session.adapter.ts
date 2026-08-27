import type { Session } from "~/server/auth";

export type LangyActorUserReader = {
  user: {
    findUnique(input: {
      where: { id: string };
      select: { id: true; name: true; email: true; image: true };
    }): Promise<{
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    } | null>;
  };
};

export type LangyActorResolution =
  | { ok: true; session: Session }
  | { ok: false; reason: "actor-missing"; message: string };

export async function resolveLangyActorSession(input: {
  users: LangyActorUserReader;
  userId: string;
  now: Date;
}): Promise<LangyActorResolution> {
  const user = await input.users.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, image: true },
  });
  if (!user) {
    return {
      ok: false,
      reason: "actor-missing",
      message:
        "The user this API key belongs to no longer exists. Langy turns are attributed to a real person, so this key cannot start one.",
    };
  }

  return {
    ok: true,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
      expires: input.now.toISOString(),
    },
  };
}
