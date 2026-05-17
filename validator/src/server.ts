import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { log, PORT } from "./config.js";
import ordersRouter from "./routes/orders.js";
import proofsRouter from "./routes/proofs.js";
import disputesRouter from "./routes/disputes.js";
import ridersRouter from "./routes/riders.js";
import { startEventIndexer } from "./blockchain/eventIndexer.js";

const app: express.Express = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/orders", ordersRouter);
app.use("/proofs", proofsRouter);
app.use("/disputes", disputesRouter);
app.use("/riders", ridersRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) log.error({ err }, "Internal error");
  res.status(status).json({ error: err.message });
});

startEventIndexer();

app.listen(PORT, () => {
  log.info({ port: PORT }, "VGDP validator listening");
});

export default app;
