import { Router, type Request, type Response, type NextFunction } from "express";
import { updateService } from "../services/updateService.js";
import { createUpdateBodySchema, listUpdatesQuerySchema, roomIdSchema } from "../validation/schemas.js";

export const updatesRouter = Router();

updatesRouter.post("/rooms/:roomId/updates", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = roomIdSchema.parse(req.params.roomId);
    const body = createUpdateBodySchema.parse(req.body);

    const update = await updateService.publish({ roomId, message: body.message });

    res.status(201).json(update);
  } catch (err) {
    next(err);
  }
});

updatesRouter.get("/rooms/:roomId/updates", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roomId = roomIdSchema.parse(req.params.roomId);
    const query = listUpdatesQuerySchema.parse(req.query);

    const { updates, nextCursor } = await updateService.listSince({
      roomId,
      after: query.after,
      limit: query.limit
    });

    res.status(200).json({ updates, nextCursor });
  } catch (err) {
    next(err);
  }
});
