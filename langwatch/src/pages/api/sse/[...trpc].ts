import type { NextApiRequest, NextApiResponse } from "next";
import superjson from "superjson";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:sse");

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
) {
    if (req.method !== "GET") {
        res.status(405).json({ message: "Method not allowed" });
        return;
    }

    const { trpc } = req.query;
    const path = Array.isArray(trpc) ? trpc.join(".") : (trpc ?? "");
    if (!path) {
        res.status(400).json({ message: "Missing trpc path" });
        return;
    }

    const inputParam =
        typeof req.query.input === "string" ? req.query.input : undefined;
    const input = inputParam ? superjson.parse(inputParam) : undefined;

    const ctx = await createTRPCContext({ req, res });
    const caller = appRouter.createCaller(ctx);
    const procedure = path
        .split(".")
        .reduce<any>((obj, key) => obj?.[key], caller);

    if (typeof procedure !== "function") {
        res.status(404).json({ message: "Procedure not found" });
        return;
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    if (typeof (res as any).flushHeaders === "function")
        (res as any).flushHeaders();

    const writeData = (value: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        const payload = superjson.stringify(value);
        for (const line of payload.split(/\r?\n/)) res.write(`data: ${line}\n`);
        res.write("\n");
    };

    let ended = false;
    let unsubscribe: (() => void) | null = null;

    const ping = setInterval(() => {
        if (res.writableEnded || res.destroyed) end();
        else res.write(": ping\n\n");
    }, 25_000);

    const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(ping);
        try {
            unsubscribe?.();
            // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional - ignore cleanup errors
        } catch {}
        unsubscribe = null;
        res.end();
    };

    req.on("close", end);

    writeData({ type: "connected" });

    try {
        const result = await procedure(input);

        // AsyncIterable
        if (result && typeof result[Symbol.asyncIterator] === "function") {
            for await (const data of result as AsyncIterable<unknown>) {
                if (res.writableEnded || res.destroyed) break;
                writeData(data);
            }
            writeData({ type: "complete" });
            end();
            return;
        }

        // Observable-like (tRPC subscriptions)
        if (result && typeof (result as any).subscribe === "function") {
            const sub = (result as any).subscribe({
                next: (data: unknown) => writeData(data),
                complete: () => {
                    writeData({ type: "complete" });
                    end();
                },
                error: (err: unknown) => {
                    logger.error({ err, path }, "SSE observable error");
                    writeData({
                        type: "error",
                        message:
                            err instanceof Error
                                ? err.message
                                : "Subscription error",
                    });
                    end();
                },
            });

            if (typeof sub === "function") unsubscribe = sub;
            else if (sub && typeof sub.unsubscribe === "function")
                unsubscribe = () => sub.unsubscribe();

            return; // keep connection open
        }

        // Non-streaming
        writeData(result);
        writeData({ type: "complete" });
        end();
    } catch (error) {
        logger.error({ error, path, input }, "SSE handler error");
        writeData({
            type: "error",
            message:
                error instanceof Error
                    ? error.message
                    : "Internal server error",
        });
        end();
    }
}

export const config = { api: { bodyParser: false } };
