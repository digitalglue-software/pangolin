import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { response } from "@server/lib/response";
import { createSessionForIdpUser } from "@server/auth/sessions/createSessionForIdpUser";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z
    .object({
        userId: z.string().nonempty()
    })
    .strict();

export type CreateIdpSessionResponse = {
    token: string;
    expiresAt: number;
};

/**
 * Mints a Pangolin user session token for an already-authenticated external
 * identity, bridging an external IdP session into Pangolin without the
 * interactive browser OIDC flow. The caller is trusted via an org-scoped API
 * key granted the createIdpSession action; the external JWT is not sent. The
 * user must already be provisioned into the org — no claim-mapping or
 * autoprovision happens here.
 */
export async function createIdpSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedParams = paramsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedParams.error).toString()
            )
        );
    }

    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { orgId, idpId } = parsedParams.data;
        const { userId } = parsedBody.data;

        const { token, expiresAt } = await createSessionForIdpUser(userId, {
            orgId,
            idpId
        });

        return response<CreateIdpSessionResponse>(res, {
            data: { token, expiresAt },
            success: true,
            error: false,
            message: "Session created successfully",
            status: HttpCode.CREATED
        });
    } catch (e) {
        if (createHttpError.isHttpError(e)) {
            return next(e);
        }
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create IdP session"
            )
        );
    }
}
