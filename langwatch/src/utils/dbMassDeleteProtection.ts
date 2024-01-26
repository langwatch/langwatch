// From: https://github.com/prisma/prisma/issues/20169
import { isEmpty } from "lodash";
import { type Prisma } from "@prisma/client";

/**
 * Middleware featured below
 */

// This naming convention specifically matches the
// safe word to the exported constant to support the
// middleware error handling
export const safeWordDelete = "FORCE_DELETE_ALL";
export const FORCE_DELETE_ALL = { id: safeWordDelete };

export const safeWordFind = "FIND_ALL";
export const FIND_ALL = { id: safeWordFind };

export const safeWordUpdate = "UPDATE_ALL";
export const UPDATE_ALL = { id: safeWordUpdate };

/**
 * If you have found yourself here after a hard lesson:
 *
 * These middleware specifically do NOT guard in the case of a nested find, update, delete.
 * These middleware also don't protect in the case of an undefined variable being passed in alongside a specific condition.
 *
 * Ex: {
 *    id, // undefined
 *    otherAttr: null
 * }
 *
 * The above where clause will delete/modify/find all regardless of undefined status of variable appId.
 *
 * The !! best !! guard here is proper type adherence - do not bang, do not coerce.
 */
const _guardEnMasse = ({
  params,
  actions,
  safeWord,
}: {
  params: Prisma.MiddlewareParams;
  actions: Prisma.MiddlewareParams["action"][];
  safeWord: string;
}) => {
  // Check if empty, if not and safeWord is provided, then set where = {} and proceed to execute
  if (actions.includes(params.action)) {
    // Don't allow delete all queries
    if (isEmpty(params.args.where)) {
      throw new Error(
        `It looks like you just tried to perform a ${params.action} on all of the ${params.model}s. If this was intentional, pass 'where: ${safeWord}'`
      );
    }
  }

  if (params.args?.where?.id === safeWord) {
    params.args.where = {};
  }
};

export const guardEnMasse: any = async (params: any, next: any) => {
  /* DELETION PROTECTION MIDDLEWARE */
  _guardEnMasse({
    actions: ["delete", "deleteMany"],
    params,
    safeWord: safeWordDelete,
  });

  /* MASS UPDATE PROTECTION MIDDLEWARE */
  _guardEnMasse({
    actions: ["updateMany"],
    params,
    safeWord: safeWordUpdate,
  });

  return next(params);
};
