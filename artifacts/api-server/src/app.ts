import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { getImage } from "./lib/image-store";
import { logger } from "./lib/logger";
import {
  dashboardAuthRouter,
  requireDashboardAuth,
} from "./lib/dashboard-auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

// Gallery uploads must be publicly fetchable: Discord downloads them itself
// when turning them into presence images.
app.get("/uploads/:id", (request, response) => {
  const image = getImage(request.params.id);
  if (!image) {
    response.status(404).end();
    return;
  }
  response.setHeader("Content-Type", image.contentType);
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.end(image.data);
});

app.use("/api", dashboardAuthRouter);
app.use("/api", requireDashboardAuth);
app.use("/api", router);

const frontendDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../discord-controller/dist/public",
);

app.use(express.static(frontendDist));
app.use((request, response, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    next();
    return;
  }

  if (request.path.startsWith("/api/")) {
    next();
    return;
  }

  response.sendFile(path.join(frontendDist, "index.html"), (error) => {
    if (error) next(error);
  });
});

export default app;
